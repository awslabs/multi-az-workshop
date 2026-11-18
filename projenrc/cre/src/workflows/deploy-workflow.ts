// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * The GitHub deploy workflow: the per-stack deploy jobs, run after a PR merges to main.
 *
 * The PR flow is projen's (as in multi-az-workshop): `npx projen push` opens the PR with the
 * `auto-approve` and `auto-merge` labels; projen's auto-approve workflow approves a trusted
 * author's labelled PR and its auto-queue workflow enables auto-merge (squash). Branch protection
 * on main requires the `build` check and an approval, so the PR merges only once the build passed.
 * The merge is a push to main, which runs this workflow. That is the same model as GitLab: main
 * takes no direct pushes, and every change deploys when its MR/PR merges.
 *
 * Triggers:
 *  - push to main: the merged PR (merged by projen's auto-merge with the builder's GitHub App token, not GITHUB_TOKEN, so it triggers this);
 *  - workflow_dispatch: redeploy main by hand;
 *  - schedule (with containerImages): the weekly OS patch of the images.
 *
 * Jobs: `build` (checks out the exact commit, `npx projen build`, uploads dist/content.zip),
 * `deploy-upload`, one job per stack (stack-jobs.ts, the same needs and variables as the GitLab
 * pipeline and the local deploy) and `deploy-prune`. Each job assumes the role it deploys as
 * directly through OIDC, never by role chaining: the runner role (the RUNNER_ROLE_ARN secret), or
 * its stack's `assumeRole` (a DNS account's DNS_ROLE_ARN; an optional one falls back to the runner
 * role). Every such role trusts only main's OIDC subject (setup); in a public repo, only the `AWS`
 * environment's, which only the deploy jobs declare and only main may use.
 *
 * Concurrency: one deploy run at a time per repository (the workflow's `concurrency` group,
 * cancel-in-progress off), so two merges never update one stack at once and a running deploy is
 * never cancelled mid-CloudFormation. A run still waiting when a newer merge arrives is cancelled
 * by GitHub, and the newer run deploys both (watch follows it: review 10d F3). GitLab serialises
 * per stack job instead (`resource_group`).
 */

import { GithubWorkflow } from 'projen/lib/github';
import type { GitHub } from 'projen/lib/github';
import { JobPermission } from 'projen/lib/github/workflows-model';
import type { JobStep } from 'projen/lib/github/workflows-model';
import { UpgradeDependenciesSchedule } from 'projen/lib/javascript';
import { ACTIONS, DEPLOY_CONCURRENCY, ON_MAIN, projenJobSetup, secretsEnv } from './actions';
import { addGithubApproval } from './approval';
import { craneInstall } from './container-tools';
import { GITHUB, PRUNE_JOB, render, RUNNER_ROLE_VARIABLE, UPLOAD_JOB } from '../components/stack-jobs';
import type { JobValue, StackJob } from '../components/stack-jobs';

/** The build job's artifact carrying dist/content.zip. */
const CONTENT_ARTIFACT = 'demo-content';
/** The build job, which every deploy job needs. */
export const BUILD_JOB = 'build';

/**
 * Options for {@link createDeployWorkflow}.
 *
 * `containerImages` is the GitHub half of the single load-gen toggle: the build job builds the
 * images into dist/content.zip (`build:docker`), and `deploy-upload` pushes the tarballs with crane.
 */
export interface DeployWorkflowOptions {
  /** The project name: `PROJECT_NAME`, the same literal the GitLab pipeline sets. */
  readonly projectName: string;
  /**
   * Where the upload and prune jobs get credentials: the partition's control-plane region. They
   * reach every region's bucket by name; each stack job uses its own stack's region.
   */
  readonly credentialsRegion: string;
  readonly containerImages?: boolean;
  /** Steps before the build job's build: the same ones the PR build runs (QEMU, pytest, the project's buildSetup). */
  readonly preBuildSteps?: JobStep[];
  /** Secrets the build job's build reads (the PR build gets the same ones). @default none */
  readonly buildSecrets?: readonly string[];
  /** One deploy job per stack (stack-jobs.ts). */
  readonly jobs: readonly StackJob[];
  /** Delete old deploy prefixes after every stack deployed. @default true */
  readonly pruneAssets?: boolean;
  /**
   * How long the deploy jobs' AWS credentials last, when the runner role allows more than the 1 h
   * default (GITHUB_ROLE_SECONDS: setup's runner role allows 2 h). @default 1 h (the action's)
   */
  readonly roleDurationSeconds?: number;
  /**
   * The repo is public (or internal): its artifacts can be downloaded by any signed-in GitHub user,
   * so the stack outputs and the content zip are kept 1 day, not 7 (review 10b D11). Stack outputs
   * must never be sensitive in any repo; this narrows how long they are exposed.
   */
  readonly publicRepo?: boolean;
  /**
   * The GitHub environment every deploy job runs in (a public repo's, DEPLOY_ENVIRONMENT): only
   * main may deploy to it (setup's deployment branch policy), its secrets reach only these jobs,
   * and the runner role trusts its OIDC subject (`repo:…:environment:AWS`), not main's, so no
   * other workflow on main (the weekly upgrade) can assume it. Private repos on GitHub's free plan
   * have no environments. @default none
   */
  readonly environment?: string;
  /**
   * After every stack deployed, a `release` job tags the commit and makes its release (the
   * `release` task, release.py), with the job's token (contents: write). A workshop's publish sends
   * the latest release. @default false
   */
  readonly release?: boolean;
  /** One approval before the deploy, and before a teardown (src/workflows/approval.ts). @default false */
  readonly approval?: boolean;
  /**
   * Delete the stacks after every deploy that succeeded (the weekly image patch's too). The
   * `teardown` workflow, run by hand, deletes them either way. @default false
   */
  readonly teardownAfterDeploy?: boolean;
}

/** teardownAfterDeploy's job after the deploy, and the manual teardown workflow. */
export const TEARDOWN_JOB = 'teardown';
export const TEARDOWN_WORKFLOW = 'teardown';
/** A workshop's release job, after the deploy (both providers). */
export const RELEASE_JOB = 'release';

/** Days a deploy artifact is kept: 1 in a public or internal repo (anyone can read it), else 7. One
 * value for the content and the outputs artifacts, so neither outlives the other (review 10c G10). */
const artifactRetentionDays = (publicRepo: boolean | undefined): number => (publicRepo ? 1 : 7);

/** The deploy workflow's name: watch.py and ci.py find its runs by it (DEPLOY_WORKFLOW there). */
export const DEPLOY_WORKFLOW = 'deploy';

export function createDeployWorkflow(github: GitHub, opts: DeployWorkflowOptions): void {
  const retentionDays = artifactRetentionDays(opts.publicRepo);
  // One run at a time (#7): runs never interleave, so every stack ends at the same commit. A run
  // already deploying finishes; of the runs waiting, GitHub keeps only the newest, which deploys
  // main's latest commit to every stack anyway.
  const workflow = new GithubWorkflow(github, DEPLOY_WORKFLOW, {
    limitConcurrency: true,
    concurrencyOptions: DEPLOY_CONCURRENCY,
  });
  workflow.on({
    push: { branches: ['main'] },
    workflowDispatch: {},
    // The weekly OS patch: main rebuilt (the runner has no image cache, so every image is built
    // again with the OS updates), each image tagged by its packages (build:image-tags) and deployed,
    // so ECS redeploys only an image whose packages changed. No PR: nothing is committed. At the
    // dependency upgrade's time (projen's upgrade-main), as GitLab's patch rides its schedule.
    ...(opts.containerImages ? { schedule: UpgradeDependenciesSchedule.WEEKLY.cron.map((cron) => ({ cron })) } : {}),
  });

  // The commit this run deploys: the merge commit on push, main's head on a dispatch from main.
  const setup = projenJobSetup();
  workflow.addJob(BUILD_JOB, {
    if: ON_MAIN,
    runsOn: ['ubuntu-24.04-arm'],
    permissions: { contents: JobPermission.READ },
    env: { CI: 'true', PROJECT_NAME: opts.projectName },
    steps: [
      ...setup,
      // The PR build's own pre-build steps (QEMU for build:docker, pytest, the project's buildSetup),
      // so main builds with what the PR built with.
      ...(opts.preBuildSteps ?? []),
      // The build regenerates the pipeline and plan first, so check the committed ones before (#15).
      { name: 'Generated files are current', run: 'npx projen check:generated' },
      // The secrets the build itself reads (a workshop's build tool location, per platform): this
      // step only, not the setup's third-party actions.
      { name: 'Build', run: 'npx projen build', ...(opts.buildSecrets?.length ? { env: secretsEnv(opts.buildSecrets) } : {}) },
      {
        name: 'Upload content artifact',
        uses: ACTIONS.uploadArtifact,
        with: { 'name': CONTENT_ARTIFACT, 'path': 'dist/content.zip', 'retention-days': retentionDays, 'if-no-files-found': 'error' },
      },
    ],
  });
  addDeployJobs(workflow, opts, setup);
  addTeardownWorkflow(github, opts, setup);
}

/** Every deploy-variable reference inside a job value. */
function varRefs(x: JobValue): Extract<JobValue, { kind: 'var' }>[] {
  if (x.kind === 'var') return [x];
  if (x.kind === 'lines') return x.lines.flatMap(([, y]) => varRefs(y));
  return [];
}

// Every deploy job has the same base (permissions, concurrency, the shared env, the setup steps and
// the AWS credentials); a stack job adds its needs and the variables stack-jobs.ts generates for it.
function addDeployJobs(workflow: GithubWorkflow, opts: DeployWorkflowOptions, setup: JobStep[]): void {
  const retentionDays = artifactRetentionDays(opts.publicRepo);
  const credentials = (region: string, role?: StackJob['credentials']) => credentialsStep(opts, region, role);
  const job = (id: string, needs: string[], steps: any[]) => {
    workflow.addJob(id, {
      needs,
      // No per-job concurrency: the workflow runs one at a time and is never cancelled mid-deploy
      // (its own concurrency group), so two runs' jobs never meet (review 10b F18). No `actions:
      // read`: downloading this run's own artifacts doesn't need it (review 10b D12).
      runsOn: ['ubuntu-latest'],
      ...(opts.environment ? { environment: { name: opts.environment } } : {}),
      permissions: { contents: JobPermission.READ, idToken: JobPermission.WRITE },
      env: {
        CI: 'true',
        PROJECT_NAME: opts.projectName,
        // One prefix for every job of the run (and a re-run of one), as GitLab's CI_PIPELINE_ID.
        ASSETS_PREFIX: `${opts.projectName}/\${{ github.run_id }}/`,
      },
      steps,
    });
  };

  // The build job already built any images into dist/content.zip; this job only pushes them.
  const craneSteps = opts.containerImages
    ? [{
      name: 'Install crane (pushes the pre-built images)',
      run: `${craneInstall('$HOME/.local/bin')} && echo "$HOME/.local/bin" >> "$GITHUB_PATH"`,
    }]
    : [];
  const approved = opts.approval ? [addGithubApproval(workflow, [BUILD_JOB])] : [];
  job(UPLOAD_JOB.github, [BUILD_JOB, ...approved], [
    ...setup,
    { name: 'Download content artifact', uses: ACTIONS.downloadArtifact, with: { name: CONTENT_ARTIFACT, path: 'dist' } },
    credentials(opts.credentialsRegion),
    ...craneSteps,
    {
      name: 'Publish templates, assets and images',
      run: 'npx projen deploy:upload',
      // The first upload to a region makes its bucket stack, as CloudFormation's execution role; with a
      // DNS account, its deploy role may read the templates (scripts/build/assets.py).
      env: Object.fromEntries(['CFN_EXECUTION_ROLE_ARN', 'DNS_ROLE_ARN'].map((n) => [n, render({ kind: 'var', name: n, optional: true }, GITHUB)])),
    },
  ]);

  const outputsArtifact = (j: StackJob) => `stack-outputs-${j.githubJob}`;
  for (const j of opts.jobs) {
    const needs = j.needs.map((n) => opts.jobs.find((x) => x.stack === n)!);
    // Each deploy variable it uses, under its own name (REQUIRED_VARS checks them; the role
    // fallback reads CFN_EXECUTION_ROLE_ARN).
    const refs = Object.values(j.env).flatMap(varRefs);
    const variables = Object.fromEntries(j.variables.map((v) => {
      const own = refs.find((x) => x.name === v);
      return [v, render(own ?? { kind: 'var', name: v, optional: false }, GITHUB)];
    }));
    job(j.githubJob, [UPLOAD_JOB.github, ...needs.map((n) => n.githubJob)], [
      ...setup,
      // The outputs of the stacks it needs, as GitLab's dotenv artifacts: each job uploaded
      // dist/<stack>.env; load them into the environment of the steps below.
      ...needs.map((n) => ({
        name: `Download ${n.stack.id} outputs`,
        uses: ACTIONS.downloadArtifact,
        with: { name: outputsArtifact(n), path: 'dist' },
      })),
      ...(needs.length
        ? [{
          name: 'Load the outputs it takes',
          run: needs.map((n) => `cat "dist/${n.stack.id}.env" >> "$GITHUB_ENV"`).join('\n'),
        }]
        : []),
      credentials(j.stack.region, j.credentials),
      {
        name: `Deploy ${j.stack.id}`,
        run: 'npx projen deploy:stack',
        env: { ...variables, ...Object.fromEntries(Object.entries(j.env).map(([k, v]) => [k, render(v, GITHUB)])) },
      },
      {
        name: 'Upload its outputs',
        uses: ACTIONS.uploadArtifact,
        with: { 'name': outputsArtifact(j), 'path': `dist/${j.stack.id}.env`, 'retention-days': retentionDays, 'if-no-files-found': 'error' },
      },
    ]);
  }

  if (opts.pruneAssets !== false) {
    job(PRUNE_JOB.github, [UPLOAD_JOB.github, ...opts.jobs.map((j) => j.githubJob)], [
      ...setup,
      credentials(opts.credentialsRegion),
      { name: 'Remove old deploy prefixes', run: 'npx projen deploy:prune' },
    ]);
  }

  if (opts.release) {
    // After every stack job succeeded: the commit the deploy tested, tagged and released (none when
    // a stack failed). It needs no AWS and no environment; it doesn't wait for the teardown.
    workflow.addJob(RELEASE_JOB, {
      needs: [UPLOAD_JOB.github, ...opts.jobs.map((j) => j.githubJob)],
      runsOn: ['ubuntu-latest'],
      permissions: { contents: JobPermission.WRITE },
      env: { CI: 'true', PROJECT_NAME: opts.projectName, GH_TOKEN: '${{ github.token }}' },
      // The whole history and every tag: the next version follows the latest one.
      steps: [...projenJobSetup(true), { name: 'Tag and release the deployed commit', run: 'npx projen release' }],
    });
  }

  if (opts.teardownAfterDeploy) {
    // After every job of a deploy that succeeded (a failed one stays up to be diagnosed).
    job(TEARDOWN_JOB, [UPLOAD_JOB.github, ...opts.jobs.map((j) => j.githubJob), ...(opts.pruneAssets !== false ? [PRUNE_JOB.github] : [])], [
      ...setup,
      credentials(opts.credentialsRegion),
      { name: 'Delete the stacks', run: 'npx projen teardown' },
    ]);
  }
}

const RUNNER: StackJob['credentials'] = { kind: 'var', name: RUNNER_ROLE_VARIABLE, optional: false };

/** The AWS credentials step: the runner role (or a stack's own), in `region`. */
function credentialsStep(opts: DeployWorkflowOptions, region: string, role: StackJob['credentials'] = RUNNER): JobStep {
  return {
    name: 'Configure AWS credentials',
    uses: ACTIONS.configureAwsCredentials,
    with: {
      'role-to-assume': render(role, GITHUB),
      'aws-region': region,
      'mask-aws-account-id': true,
      // A CloudFront or certificate stack can outlast 1 h of credentials (review 10b D3).
      ...(opts.roleDurationSeconds && opts.roleDurationSeconds > 3600 ? { 'role-duration-seconds': opts.roleDurationSeconds } : {}),
    },
  };
}

/**
 * The `teardown` workflow: deletes the stacks, by hand (`npx projen teardown` from CI). It shares
 * the deploy workflow's concurrency group, so it never runs in the middle of a deploy.
 */
function addTeardownWorkflow(github: GitHub, opts: DeployWorkflowOptions, setup: JobStep[]): void {
  const wf = new GithubWorkflow(github, TEARDOWN_WORKFLOW, {
    limitConcurrency: true,
    concurrencyOptions: DEPLOY_CONCURRENCY,
  });
  wf.on({ workflowDispatch: {} });
  const approved = opts.approval ? [addGithubApproval(wf)] : [];
  wf.addJob(TEARDOWN_JOB, {
    ...(approved.length ? { needs: approved } : {}),
    if: ON_MAIN,
    runsOn: ['ubuntu-latest'],
    ...(opts.environment ? { environment: { name: opts.environment } } : {}),
    permissions: { contents: JobPermission.READ, idToken: JobPermission.WRITE },
    env: { CI: 'true', PROJECT_NAME: opts.projectName },
    steps: [
      ...setup,
      credentialsStep(opts, opts.credentialsRegion),
      { name: 'Delete the stacks', run: 'npx projen teardown' },
    ],
  });
}
