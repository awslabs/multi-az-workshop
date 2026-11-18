import { gitlab } from 'projen';
import type { Project } from 'projen';
import { GithubWorkflow } from 'projen/lib/github';
import type { GitHub } from 'projen/lib/github';
import { JobPermission } from 'projen/lib/github/workflows-model';
import type { JobStep } from 'projen/lib/github/workflows-model';
import { ON_MAIN, projenJobSetup, secretsEnv } from './actions';
import { addGithubApproval } from './approval';
import { CRE_SCRIPTS } from '../paths';

/**
 * A Workshop Studio workshop's publish from CI, by hand: the user pastes the workshop's 1-hour
 * Repository credentials into the repository's secrets (WS_ACCESS_KEY_ID, WS_SECRET_ACCESS_KEY,
 * WS_SESSION_TOKEN; setup made them placeholders), then runs it. It builds the commit and runs
 * `npx projen publish` with every input from the secrets, the same publish `npx projen publish
 * --local` runs with the inputs from a laptop's Midway session. Only main's commits (publish.py
 * refuses others).
 */
export const PUBLISH_SECRETS = ['WS_ACCESS_KEY_ID', 'WS_SECRET_ACCESS_KEY', 'WS_SESSION_TOKEN', 'REMOTE_REPO', 'ASSETS_LOCATION',
  'GIT_PLUGIN_LOCATION', 'GIT_PLUGIN'];

export function createGithubPublishWorkflow(github: GitHub, buildToolSecrets: readonly string[], approval = false,
  preBuildSteps: JobStep[] = []): void {
  const wf = new GithubWorkflow(github, 'publish');
  wf.on({
    workflowDispatch: {
      inputs: {
        version: { description: 'The release to publish (v<x.y.z>); empty: the latest', required: false, type: 'string' },
      },
    },
  });
  const approved = approval ? [addGithubApproval(wf)] : [];
  wf.addJob('publish', {
    ...(approved.length ? { needs: approved } : {}),
    if: ON_MAIN,
    runsOn: ['ubuntu-24.04-arm'],
    permissions: { contents: JobPermission.READ },
    env: { CI: 'true', WORKSHOP_ID: '${{ vars.WORKSHOP_ID }}' },
    steps: [
      // The whole history and every tag, then the release (the latest, or the input's) checked out
      // before anything installs or builds: the lockfile and the code are the release's.
      ...releaseSetup(),
      // What the build needs, as the PR build and the deploy have it (buildSetup).
      ...preBuildSteps,
      // Each step gets only the secrets it reads: the build its tool's location, the upload the
      // workshop's credentials and targets (no install, build or third-party step sees those).
      { name: 'Build', run: 'npx projen build', env: secretsEnv(buildToolSecrets) },
      { name: 'Publish', run: 'npx projen publish:upload', env: { ...secretsEnv(PUBLISH_SECRETS), RELEASE_VERSION: '${{ inputs.version }}' } },
    ],
  });
}

/** The checkout, the release checked out (input `version`, else the latest), then Node and its install. */
function releaseSetup(): JobStep[] {
  const [checkout, ...rest] = projenJobSetup(true);
  return [
    checkout,
    // Through env, never interpolated into the command.
    { name: 'Check out the release', run: `python3 ${CRE_SCRIPTS}/build/publish.py checkout`, env: { CI: 'true', RELEASE_VERSION: '${{ inputs.version }}' } },
    ...rest,
  ];
}

export const GITLAB_PUBLISH_JOB = 'publish:workshop';

/** GitLab: a play-button job on main's pipelines, in its own stage (it holds nothing up). */
export function createGitlabPublishJob(project: Project, buildSetup: readonly string[] = []): void {
  const ci = project.components.find((c): c is gitlab.GitlabConfiguration => c instanceof gitlab.GitlabConfiguration);
  if (!ci) return;
  ci.addStages('publish');
  ci.createNestedTemplates({
    publish: {
      jobs: {
        [GITLAB_PUBLISH_JOB]: {
          stage: 'publish',
          needs: [],
          // The CI/CD variables setup set (and the credentials pasted) reach every job of main.
          variables: { GIT_DEPTH: '0' },
          rules: [{ if: '$CI_COMMIT_BRANCH == "main" && $CI_PIPELINE_SOURCE != "schedule"', when: gitlab.JobWhen.MANUAL, allowFailure: true }],
          // The git plugin installs into a virtualenv: pip. Then what the build needs (buildSetup).
          // The release (RELEASE_VERSION, set when you run it, else the latest) is checked out, its
          // own dependencies installed, then it is built and published.
          script: ['apk add --no-cache py3-pip', ...buildSetup, `python3 ${CRE_SCRIPTS}/build/publish.py checkout`,
            'yarn install --immutable', 'npx projen publish'],
        },
      },
    },
  });
}
