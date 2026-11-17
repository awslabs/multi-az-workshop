import { gitlab } from 'projen';
import type { awscdk } from 'projen';
import { NODE_MAJOR } from './actions';
import { craneInstall } from './container-tools';
import { CREDENTIALS_VARIABLE, GITLAB, PRUNE_JOB, render, RUNNER_ROLE_VARIABLE, UPLOAD_JOB, VERSIONS_ROLE_VARIABLE } from '../components/stack-jobs';
import type { JobDefaults, StackJob } from '../components/stack-jobs';
import { CRE_SCRIPTS } from '../paths';

/** How long build and deploy artifacts are kept: a retried job needs them (review N6). */
const ARTIFACT_EXPIRY = '7 days';

/**
 * Base image for every job. `node:22-alpine` is small, multi-arch, ships
 * npm/yarn via corepack, and Alpine's apk repo carries the rest of the toolchain
 * (aws-cli, git, python, bash). Every job uses it except build:docker.
 *
 * Container builds (kaniko executor image, then a crane push in the deploy) are emitted ONLY
 * when containerImages is true. The shared GitLab runner fleet blocks Docker-in-Docker
 * (seccomp) and rootless podman/buildah (CLONE_NEWUSER), hence kaniko.
 */
const BASE_IMAGE = `node:${NODE_MAJOR}-alpine`;

/**
 * Pre-job toolchain install for every job. `corepack enable` works because
 * node:22-alpine bundles corepack.
 *   - aws-cli + git + python3 + bash + tar/gzip/zip/unzip from Alpine community
 *   - python3 is needed by scripts/build/package.py (asset staging) and
 *     the deploy scripts (scripts/build/*.py)
 */
const TOOLCHAIN_PACKAGES = 'bash aws-cli git python3 tar gzip zip unzip curl';

/** The toolchain install, plus pytest when the project runs Python tests (`pythonTests`). */
function toolchainInstall(pythonTests?: boolean): string[] {
  return [`apk add --no-cache ${TOOLCHAIN_PACKAGES}${pythonTests ? ' py3-pytest' : ''}`];
}

const YARN_SETUP = [
  // corepack picks package.json's packageManager (the pinned yarn); `prepare yarn@stable` fetched
  // the latest yarn in every job (review 10b D25).
  'corepack enable',
  'yarn install --immutable',
];

/**
 * Kaniko executor image (the container build). All other container build
 * tools fail on the shared GitLab runner fleet: Docker-in-Docker is blocked by seccomp,
 * and rootless podman/buildah trip `unshare(CLONE_NEWUSER): Operation not permitted`.
 * Kaniko builds OCI images in a chroot — no daemon, no user namespaces. The `:debug`
 * tag is distroless + busybox (no apk/node/yarn), so the build:docker job's beforeScript
 * MUST be empty and its script invoked via `sh`.
 */
const KANIKO_VERSION = 'v1.23.2';
// Pinned by digest (the multi-arch index): a tag can be moved, and this image builds the images the
// deploy pushes (review 10b D6).
export const KANIKO_IMAGE = `gcr.io/kaniko-project/executor:${KANIKO_VERSION}-debug@sha256:c3109d5926a997b100c4343944e06c6b30a6804b2f9abe0994d3de6ef92b028e`;


/**
 * Extra install step for deploy:upload: downloads crane (static Go binary) so
 * deploy-docker.py can push image tarballs to ECR without a docker daemon. Only added
 * to deploy:upload's beforeScript when containerImages is true.
 */
const CRANE_INSTALL = [craneInstall('/usr/local/bin')];

/** teardownAfterDeploy's job: deletes the stacks once every deploy job succeeded. */
export const TEARDOWN_JOB = 'deploy:teardown';
/** The play-button job that deletes the stacks by hand (`npx projen teardown` from CI). */
export const MANUAL_TEARDOWN_JOB = 'teardown';

/** The weekly dependency upgrade job, and the branch its MR comes from. */
export const UPGRADE_JOB = 'upgrade:main';
export const UPGRADE_BRANCH = 'cre/upgrade-main';
export const UPGRADE_TITLE = 'chore(deps): upgrade dependencies';
/** The CI/CD variable holding the upgrade's project access token (cresetup/gitlab.py UPGRADE_VARIABLE). */
export const UPGRADE_VARIABLE = 'CRE_UPGRADE_TOKEN';
/** The environment every deploy job runs in; setup scopes the protected variables to it (cresetup/gitlab.py DEPLOY_ENVIRONMENT). */
export const DEPLOY_ENVIRONMENT = 'AWS';
/** The weekly schedule's pipeline on main (CRE_UPGRADE=1), which also patches the images (createGitlabWorkflow). */
export const SCHEDULED_PATCH = '$CI_PIPELINE_SOURCE == "schedule" && $CRE_UPGRADE == "1" && $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH';

/** The upgrade job's exit code for "skipped: a person's commit is on the branch" (a warning in the pipeline). */
export const UPGRADE_SKIPPED = 75;

/**
 * The weekly upgrade, GitLab's counterpart of projen's GitHub `upgrade-main` workflow. It runs only
 * in a pipeline started by the project's schedule (`cresetup/gitlab.py setup` creates it, weekly, on
 * main, with CRE_UPGRADE=1): `npx projen upgrade`, and when anything changed, a commit pushed to
 * UPGRADE_BRANCH with push options that open the MR, set it to merge when its pipeline succeeds,
 * squash and delete the branch. The MR pipeline builds it; the merge deploys, like any MR.
 *
 * The push uses CRE_UPGRADE_TOKEN, a project access token (write_repository only, this project
 * only) that setup stores as a masked, Protected variable: a job's own CI_JOB_TOKEN can't push
 * (gitlab.aws.dev answers 403 even with `ci_push_repository_for_job_token_allowed`).
 *
 * Its AWS credentials are the read-only versions role's (VERSIONS_ROLE_ARN, in every scope: this
 * job has no environment), for the lookups `npx projen upgrade` runs in post-upgrade
 * (versions:update), in the partition's control-plane region.
 */
function upgradeJob(credentialsRegion: string): gitlab.Job {
  const remote = `"https://cre-upgrade:\${${UPGRADE_VARIABLE}}@\${CI_SERVER_HOST}/\${CI_PROJECT_PATH}.git"`;
  const bot = 'cre-upgrade@noreply.${CI_SERVER_HOST}';
  const tracking = `refs/remotes/origin/${UPGRADE_BRANCH}`;
  const push = [
    // Replaces only the branch this job last saw: a commit pushed meanwhile stops it (review 10c B15).
    `git push --force-with-lease=refs/heads/${UPGRADE_BRANCH}:"$LEASE"`,
    remote,
    `HEAD:refs/heads/${UPGRADE_BRANCH}`,
    '-o merge_request.create',
    '-o "merge_request.target=${CI_DEFAULT_BRANCH}"',
    `-o "merge_request.title=${UPGRADE_TITLE}"`,
    '-o merge_request.merge_when_pipeline_succeeds',
    '-o merge_request.remove_source_branch',
    '-o merge_request.squash',
  ].join(' ');
  return {
    stage: 'upgrade',
    rules: [{ if: '$CI_PIPELINE_SOURCE == "schedule" && $CRE_UPGRADE == "1"', variables: { [CREDENTIALS_VARIABLE]: `$${VERSIONS_ROLE_VARIABLE}` } }],
    needs: [],
    interruptible: true,
    // A skip (a person's commit on the branch) shows as a warning, not a green job: a closed MR leaves
    // the branch, and an always-green skip hid that upgrades had stopped for good (review 10d D8).
    allowFailure: { exitCodes: [UPGRADE_SKIPPED] },
    // The full history, so "commits on the upgrade branch that main doesn't have" is exact (a shallow
    // clone would list main's older commits too).
    variables: { GIT_DEPTH: '0', AWS_REGION: credentialsRegion, AWS_DEFAULT_REGION: credentialsRegion },
    script: [
      `test -n "\${${UPGRADE_VARIABLE}:-}" || { echo "${UPGRADE_VARIABLE} is not set: run npx projen setup:repo" >&2; exit 1; }`,
      `test -n "\${${VERSIONS_ROLE_VARIABLE}:-}" || { echo "${VERSIONS_ROLE_VARIABLE} is not set: run npx projen setup:repo" >&2; exit 1; }`,
      // The token lasts a year; an expired one would fail at the push with a bare auth error (review 10c C9).
      `git ls-remote ${remote} HEAD >/dev/null 2>&1 || { echo "${UPGRADE_VARIABLE} is expired or revoked: rotate it with npx projen setup:repo" >&2; exit 1; }`,
      // A person's commit on the upgrade branch (a fix to make it build) is never force-pushed away:
      // the job skips until that MR merges or the branch is deleted (review 10c B15). LEASE is the
      // branch as the project has it now ("" when absent), which the push below must still find:
      // read with ls-remote, never from a tracking ref a reused clone may have kept after the
      // branch was deleted (review 10d D8). An unreadable remote stops the job.
      `LEASE="$(git ls-remote ${remote} refs/heads/${UPGRADE_BRANCH})" || { echo "Could not read ${UPGRADE_BRANCH} from the project." >&2; exit 1; }`,
      'LEASE="${LEASE%%[[:space:]]*}"',
      `if [ -n "$LEASE" ]; then git fetch -q ${remote} "+refs/heads/${UPGRADE_BRANCH}:${tracking}" || { echo "Could not fetch ${UPGRADE_BRANCH}." >&2; exit 1; }; fi`,
      // Author and committer: a person who amends or rebases the bot's commit keeps the bot as its
      // author, and only the committer is them (review 10f B3).
      `if [ -n "$LEASE" ] && git log --format='%ae%n%ce' "\${CI_COMMIT_SHA}..$LEASE" | grep -qvxF "${bot}"; then echo "${UPGRADE_BRANCH} has commits that aren't the upgrade job's; skipping so they are not overwritten. Merge its MR, or delete the branch (closing the MR leaves the branch, and this job keeps skipping); then the next run upgrades again." >&2; exit ${UPGRADE_SKIPPED}; fi`,
      'npx projen upgrade',
      'if [ -z "$(git status --porcelain)" ]; then echo "Dependencies are up to date: nothing to do."; exit 0; fi',
      `git config user.name "cre-upgrade" && git config user.email "${bot}"`,
      `git checkout -B ${UPGRADE_BRANCH}`,
      'git add -A',
      `git commit -q -m "${UPGRADE_TITLE}" -m "Upgrades project dependencies (scheduled pipeline \${CI_PIPELINE_URL})."`,
      push,
    ],
  };
}

/**
 * Wires the GitLab pipeline onto the project. Every job runs a projen task (the one exception,
 * build:docker on the node-less kaniko image, runs the script behind the build:docker task).
 *
 * Stages:
 *   build  — runs on MRs + main:
 *     build:cdk      `yarn ci:build:cdk` — cdk synth, the stack-wiring and stack-plan checks, lint,
 *                    unit tests, CFN asset staging (node image). Artifacts: assets/, cdk.out/.
 *     build:container-plan, build:docker  (containerImages only) — list the images, build each
 *                    with kaniko into assets/containers/.
 *     build:package  `yarn ci:build:package` — zip assets/ → dist/content.zip.
 *
 *   deploy — runs on the default branch only (split-trust analog: gated to main).
 *            The role variables (RUNNER_ROLE_ARN, DNS_ROLE_ARN, ...) MUST be **Protected**
 *            CI/CD variables scoped to the `AWS` environment, and `main` a protected branch, so
 *            only deploy jobs on main can name them; the roles themselves trust only this
 *            project's jobs on a protected branch (setup-cdk's ci-trust.ts).
 *     deploy:upload  `npx projen deploy:upload` — publish templates, assets (and images) to every
 *                    listed region's bucket.
 *     deploy:<stack> one job per stack, named after it (`deploy:<project>-edge`), `npx projen
 *                    deploy:stack`, with the variables stack-jobs.ts generates for it. `needs`:
 *                    deploy:upload plus the jobs of the stacks it takes outputs from (and its
 *                    `dependsOn`); their dist/<stack>.env dotenv artifacts carry the outputs.
 *     deploy:prune   `npx projen deploy:prune`, after every stack job.
 *
 * AWS credentials are minted by the GitLab credential vendor for the role in the job's
 * `AWS_CREDS_TARGET_ROLE`, which every deploy job sets itself (in `rules:variables`): the runner
 * role (`$RUNNER_ROLE_ARN`), or a stack's `assumeRole` (a DNS account's `$DNS_ROLE_ARN`), so each
 * job holds the role it deploys as directly, never by role chaining. A project CI/CD variable
 * outranks a job's, so `AWS_CREDS_TARGET_ROLE` must never be one.
 * `AWS_REGION` is the stack's region in each stack job (the CLI v2 reads it). Every deploy job also
 * sets `AWS_DEFAULT_REGION` to the same region: gitlab.aws.dev's AWS Credential Vendor mints
 * credentials only for a job that sets both `AWS_CREDS_TARGET_ROLE` and `AWS_DEFAULT_REGION`
 * (BuilderHub, "Vending AWS credentials to CI/CD jobs"); a job without it gets none, and every AWS
 * call fails "Unable to locate credentials" (seen live when it was removed). GitHub's credentials
 * come from aws-actions/configure-aws-credentials, which needs neither.
 *
 * Operators set these CI/CD variables in GitLab project settings (setup:repo does):
 *   RUNNER_ROLE_ARN         the runner role, which every deploy job's credentials are for unless
 *                           its stack names another. Protected: yes (see the deploy stage note).
 *   Every variable the stacks name (CreCfnParameter fromVariable, assumeRole, executionRole;
 *   CFN_EXECUTION_ROLE_ARN by default). GitLab passes project CI/CD variables to every job, so
 *   each stack job references the ones it uses, and fails fast on a required one that's empty.
 *   cre-stacks.json's `environment` lists them.
 *
 * AWS_REGION is NOT in that list. Each stack job sets its own stack's region; the pipeline-wide
 * value is `opts.credentialsRegion`, the partition's control-plane region, where the upload and
 * prune jobs get their credentials. Neither job deploys there: each reaches every region's bucket
 * by name (the plan's regions). No project chooses it, so none can choose it wrong.
 */
export function createGitlabWorkflow(
  project: awscdk.AwsCdkTypeScriptApp,
  opts: {
    credentialsRegion: string;
    containerImages?: boolean;
    jobs: readonly StackJob[];
    defaults: JobDefaults;
    pruneAssets?: boolean;
    disableDeploy?: boolean;
    teardownAfterDeploy?: boolean;
    pythonTests?: boolean;
    /** The project's own build setup (buildSetup.gitlab): build:cdk runs it after the toolchain install. */
    buildSetup?: string[];
  },
): gitlab.GitlabConfiguration {
  const TOOLCHAIN_INSTALL = toolchainInstall(opts.pythonTests);
  // The weekly schedule (CRE_UPGRADE=1) runs the upgrade (UPGRADE_JOB). In a project with container
  // images that deploys, it also patches main: every image rebuilt with no cache (OS updates
  // applied), tagged by its packages (build:image-tags) and deployed, so ECS redeploys only an image
  // whose packages changed. No MR: nothing is committed, and the image build is the check. Otherwise
  // a scheduled pipeline neither builds nor deploys.
  const patch = Boolean(opts.containerImages && !opts.disableDeploy);
  const buildRules: gitlab.IncludeRule[] = [
    { if: '$CI_PIPELINE_SOURCE == "merge_request_event"' },
    { if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $CI_PIPELINE_SOURCE != "schedule"' },
    ...(patch ? [{ if: SCHEDULED_PATCH }] : []),
  ];
  // A week, so a deploy job retried days later still finds its inputs (review N6).
  const artifacts = (paths: string[]): gitlab.Artifacts => ({ paths, expireIn: ARTIFACT_EXPIRY });

  // Everything every job shares lives in `default`: image, tags, toolchain + yarn install, the
  // yarn cache and the retry policy. A job states only what is its own (stage, needs, rules,
  // script, artifacts, variables). build:docker is the one job that overrides the base, because
  // the kaniko image has no apk/node/yarn.
  const ci = new gitlab.GitlabConfiguration(project, {
    default: {
      image: { name: BASE_IMAGE },
      // arm64 shared runner fleet.
      tags: ['arch:arm64', 'size:medium'],
      beforeScript: [...TOOLCHAIN_INSTALL, ...YARN_SETUP],
      cache: [
        {
          // Branch-scoped cache, falling back to the default branch's cache so
          // first-MR builds warm-start instead of downloading every dep.
          key: '${CI_COMMIT_REF_SLUG}-yarn',
          fallbackKeys: ['${CI_DEFAULT_BRANCH}-yarn'],
          paths: ['.yarn/cache/', 'node_modules/'],
        },
      ],
      // Transient infrastructure and throttling only; a real failure is never retried.
      retry: {
        max: 1,
        when: ['api_failure', 'runner_system_failure', 'stuck_or_timeout_failure'],
      },
    },
    stages: opts.disableDeploy ? ['build', 'upgrade'] : ['build', 'deploy', 'upgrade'],
    variables: {
      // PROJECT_NAME is plumbed here so GitLab variable expansion (ASSETS_PREFIX) resolves. The
      // same value is exposed to projen tasks via .projenrc.ts (tasks.addEnvironment).
      PROJECT_NAME: project.name,
      // Unique prefix per pipeline, scoped under $PROJECT_NAME/. Every deploy job of the
      // pipeline (and a retried one) uses the same prefix.
      ASSETS_PREFIX: '${PROJECT_NAME}/${CI_PIPELINE_ID}/',
      // Where deploy:upload and deploy:prune get credentials (the partition's control-plane region);
      // they reach every region's bucket by name. Each stack job sets its own stack's region.
      AWS_REGION: opts.credentialsRegion,
      // Defaults for deploy variables (GitLab has no `${X:-default}`). A project CI/CD
      // variable of the same name overrides them.
      ...opts.defaults,
    },
  });

  // ---- build jobs (container jobs gated on containerImages) ----------------
  //
  // Without containerImages: build:cdk + build:package. With it:
  //   build:cdk → build:container-plan → build:docker → build:package.
  const buildJobs: Record<string, gitlab.Job> = {
    // CDK synthesis, lint, unit tests, CFN asset staging. Invokes the provider-agnostic
    // ci:build:cdk task.
    'build:cdk': {
      stage: 'build',
      rules: buildRules,
      ...(opts.buildSetup?.length ? { beforeScript: [...TOOLCHAIN_INSTALL, ...opts.buildSetup, ...YARN_SETUP] } : {}),
      script: ['yarn ci:build:cdk'],
      artifacts: artifacts(['assets/', 'cdk.out/']),
    },
  };

  if (opts.containerImages) {
    // Container build plan. Reads cdk.out/*.assets.json on the node image (python3
    // present) → assets/containers/manifest.json + dist/container-plan.tsv (the
    // python-free plan build:docker reads on the distroless kaniko image).
    buildJobs['build:container-plan'] = {
      stage: 'build',
      needs: ['build:cdk'],
      rules: buildRules,
      script: ['yarn ci:build:container-plan'],
      // The per-image build args (dist/container-args-<hash>.txt) travel too: kaniko-build.sh refuses
      // to build without them, so an image is never built without its args or target (review 10c D1).
      artifacts: artifacts(['assets/containers/manifest.json', 'dist/container-plan.tsv', 'dist/container-args-*.txt']),
    };

    // Container image build. Runs on the kaniko image directly (distroless + busybox:
    // no apk/node/yarn), so beforeScript is EMPTY and the script is invoked via `sh`.
    // Reads dist/container-plan.tsv and produces assets/containers/<hash>.tar.gz.
    buildJobs['build:docker'] = {
      stage: 'build',
      image: { name: KANIKO_IMAGE, entrypoint: [''] },
      needs: ['build:cdk', 'build:container-plan'],
      // The scheduled patch builds every image again rather than reuse the cached tarball.
      rules: buildRules.map((r) => (r.if === SCHEDULED_PATCH ? { ...r, variables: { CRE_IMAGE_REBUILD: '1' } } : r)),
      beforeScript: [],
      // Content-addressed image cache (dist/.cache/containers/<hash>.tar.gz). Keyed per branch
      // so unchanged images are reused across pipelines instead of re-pulling base images from
      // public.ecr.aws (rate limits) and recompiling from scratch. A changed image → new hash →
      // cache miss → one rebuild, then re-cached. Restored/saved by the runner's cache helper,
      // so it works even on the distroless kaniko image; kaniko-build.sh skips kaniko on a hit.
      cache: [
        {
          // v2: images cached before review 10c D1 were built without their build args.
          key: 'container-tarballs-v2-$CI_COMMIT_REF_SLUG',
          // A new MR branch starts from main's images instead of rebuilding every one (review 10b D20).
          fallbackKeys: ['container-tarballs-v2-${CI_DEFAULT_BRANCH}'],
          paths: ['dist/.cache/containers/'],
        },
      ],
      script: [`sh ${CRE_SCRIPTS}/build/kaniko-build.sh`],
      artifacts: artifacts(['assets/containers/']),
    };
  }

  // Zip the staged assets/ tree into dist/content.zip — the single artifact the deploy
  // stage consumes. needs[] is conditional so the no-load-gen package job does NOT wait
  // on (non-existent) container jobs.
  buildJobs['build:package'] = {
    stage: 'build',
    needs: opts.containerImages
      ? ['build:cdk', 'build:container-plan', 'build:docker']
      : ['build:cdk'],
    rules: buildRules,
    script: ['yarn ci:build:package'],
    artifacts: artifacts(['dist/content.zip']),
  };

  // ---- deploy jobs -----------------------------------------------------------
  //
  // Every deploy job: default branch only (GitLab's split-trust analog), the `AWS` environment
  // (deploys show under Operate > Environments; make it protected to control who deploys), never
  // interrupted mid-CloudFormation (an interrupted change-set leaves the stack *_IN_PROGRESS and
  // fails the next deploy), and serialised per job across pipelines by resource_group, so two
  // pipelines never update the same stack at once while independent stacks still run in parallel.
  // The credential vendor's role, in rules:variables: a stack whose optional role variable is empty
  // deploys as the runner role, and GitLab has no `${X:-y}` to say that in `variables`.
  const merged = '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $CI_PIPELINE_SOURCE != "schedule"';
  const onMain = patch ? `(${merged}) || (${SCHEDULED_PATCH})` : merged;
  const runner: StackJob['credentials'] = { kind: 'var', name: RUNNER_ROLE_VARIABLE, optional: false };
  const credentialRules = (c: StackJob['credentials']): gitlab.IncludeRule[] => [
    ...(c.fallback ? [{ if: `${patch ? `(${onMain})` : onMain} && $${c.name}`, variables: { [CREDENTIALS_VARIABLE]: `$${c.name}` } }] : []),
    { if: onMain, variables: { [CREDENTIALS_VARIABLE]: `$${c.fallback ?? c.name}` } },
  ];
  const deployJob = (name: string, job: gitlab.Job, credentials: StackJob['credentials'] = runner): gitlab.Job => ({
    stage: 'deploy',
    rules: credentialRules(credentials),
    environment: { name: DEPLOY_ENVIRONMENT },
    interruptible: false,
    // Above deploy-stack.py's own wait (STACK_WAIT_SECONDS, 100 min), so a slow stack fails there,
    // with its events, instead of the job being killed with the stack mid-update. The vended
    // credentials end at 1 hour (role chaining): a stack still running then fails as "credentials
    // expired", and a re-run of the job waits for it.
    timeout: '2h',
    // GitLab refuses a resource_group key with `:` (deploy:<stack>) and silently drops it.
    resourceGroup: name.replace(/:/g, '-'),
    ...job,
    // The credential vendor's region (see the header): the stack's own, or the pipeline's.
    variables: { AWS_DEFAULT_REGION: job.variables?.AWS_REGION ?? '$AWS_REGION', ...job.variables },
  });

  const deployJobs: Record<string, gitlab.Job> = {
    [UPLOAD_JOB.gitlab]: deployJob(UPLOAD_JOB.gitlab, {
      needs: ['build:package'],
      // crane only with container images (it pushes the pre-built tarballs).
      ...(opts.containerImages ? { beforeScript: [...TOOLCHAIN_INSTALL, ...CRANE_INSTALL, ...YARN_SETUP] } : {}),
      script: ['npx projen deploy:upload'],
    }),
  };
  for (const j of opts.jobs) {
    deployJobs[j.gitlabJob] = deployJob(j.gitlabJob, {
      // Artifacts of a needed job are downloaded by default: deploy:upload has none the stack
      // needs, and each stack job's dist/<stack>.env dotenv brings the outputs it takes.
      needs: [UPLOAD_JOB.gitlab, ...j.needs.map((n) => opts.jobs.find((x) => x.stack === n)!.gitlabJob)],
      variables: Object.fromEntries(Object.entries(j.env).map(([k, v]) => [k, render(v, GITLAB)])),
      script: ['npx projen deploy:stack'],
      artifacts: {
        paths: [`dist/${j.stack.id}.env`],
        reports: { dotenv: [`dist/${j.stack.id}.env`] },
        expireIn: ARTIFACT_EXPIRY,
      },
    }, j.credentials);
  }
  if (opts.pruneAssets !== false) {
    deployJobs[PRUNE_JOB.gitlab] = deployJob(PRUNE_JOB.gitlab, {
      // After every stack job, and after the upload: with no stacks, `needs: []` would mean "start
      // at once", in parallel with the upload.
      needs: [{ job: UPLOAD_JOB.gitlab, artifacts: false }, ...opts.jobs.map((j) => ({ job: j.gitlabJob, artifacts: false }))],
      script: ['npx projen deploy:prune'],
    });
  }

  const teardown = { [CREDENTIALS_VARIABLE]: `$${RUNNER_ROLE_VARIABLE}` };
  // By hand (its play button), in every pipeline on main: no needs, so it runs after a failed
  // deploy too, and it never holds the pipeline up. Start it once the deploy jobs have finished.
  deployJobs[MANUAL_TEARDOWN_JOB] = deployJob(MANUAL_TEARDOWN_JOB, {
    rules: [{ if: onMain, when: gitlab.JobWhen.MANUAL, allowFailure: true, variables: teardown }],
    needs: [],
    script: ['npx projen teardown'],
  });
  if (opts.teardownAfterDeploy) {
    // At once in every pipeline that deploys (a merge to main, the weekly image patch), once every
    // stack job and the prune succeeded: a failed deploy stays up to be diagnosed.
    deployJobs[TEARDOWN_JOB] = deployJob(TEARDOWN_JOB, {
      rules: [{ if: onMain, variables: teardown }],
      needs: [UPLOAD_JOB.gitlab, ...opts.jobs.map((j) => j.gitlabJob), ...(opts.pruneAssets !== false ? [PRUNE_JOB.gitlab] : [])]
        .map((job) => ({ job, artifacts: false })),
      script: ['npx projen teardown'],
    });
  }

  // disableDeploy: no deploy template at all, so nothing in the pipeline can reach AWS.
  ci.createNestedTemplates({
    build: { jobs: buildJobs },
    ...(opts.disableDeploy ? {} : { deploy: { jobs: deployJobs } }),
    upgrade: { jobs: { [UPGRADE_JOB]: upgradeJob(opts.credentialsRegion) } },
  });

  return ci;
}
