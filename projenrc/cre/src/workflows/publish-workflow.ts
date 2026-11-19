import { gitlab } from 'projen';
import type { Project } from 'projen';
import { GithubWorkflow } from 'projen/lib/github';
import type { GitHub } from 'projen/lib/github';
import { JobPermission } from 'projen/lib/github/workflows-model';
import { ON_MAIN, projenJobSetup, secretsEnv } from './actions';
import { addGithubApproval } from './approval';
import { CRE_SCRIPTS } from '../paths';

/**
 * A Workshop Studio workshop's publish from CI, by hand: the user pastes the workshop's 1-hour
 * Repository credentials into the repository's secrets (WS_ACCESS_KEY_ID, WS_SECRET_ACCESS_KEY,
 * WS_SESSION_TOKEN; setup made them placeholders), then runs it, optionally naming a release
 * (`version`; else the latest). Nothing is built: `publish.py prepare` checks the release out and
 * unpacks its content.zip, then the upload sends it with every input from the secrets, the same
 * publish `npx projen publish --local` runs with the inputs from a laptop's Midway session. Only a
 * release of a commit on main (publish.py refuses others).
 */
export const PUBLISH_SECRETS = ['WS_ACCESS_KEY_ID', 'WS_SECRET_ACCESS_KEY', 'WS_SESSION_TOKEN', 'REMOTE_REPO', 'ASSETS_LOCATION',
  'GIT_PLUGIN_LOCATION', 'GIT_PLUGIN'];

export function createGithubPublishWorkflow(github: GitHub, approval = false): void {
  const wf = new GithubWorkflow(github, 'publish');
  wf.on({
    workflowDispatch: {
      inputs: {
        version: { description: 'The release to publish (v<x.y.z>); empty: the latest', required: false, type: 'string' },
      },
    },
  });
  const approved = approval ? [addGithubApproval(wf)] : [];
  const [checkout, ...setup] = projenJobSetup(true);
  // The input reaches the scripts through env, never interpolated into a command.
  const version = { RELEASE_VERSION: '${{ inputs.version }}' };
  wf.addJob('publish', {
    ...(approved.length ? { needs: approved } : {}),
    if: ON_MAIN,
    runsOn: ['ubuntu-24.04-arm'],
    permissions: { contents: JobPermission.READ },
    env: { CI: 'true', WORKSHOP_ID: '${{ vars.WORKSHOP_ID }}' },
    steps: [
      // The whole history and every tag, then the release (the latest, or the input's) checked out
      // and its content.zip unpacked, before anything installs: the lockfile is the release's.
      // Nothing is built: the zip is the build its deploy deployed.
      checkout,
      { name: 'Prepare the release', run: `python3 ${CRE_SCRIPTS}/build/publish.py prepare`, env: { ...version, GH_TOKEN: '${{ github.token }}' } },
      ...setup,
      // The only step with the workshop's credentials and targets.
      { name: 'Publish', run: 'npx projen publish:upload', env: { ...secretsEnv(PUBLISH_SECRETS), ...version } },
    ],
  });
}

export const GITLAB_PUBLISH_JOB = 'publish:workshop';

/** GitLab: a play-button job on main's pipelines, in its own stage (it holds nothing up). */
export function createGitlabPublishJob(project: Project): void {
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
          // The git plugin installs into a virtualenv: pip. The release (RELEASE_VERSION, set when you
          // run it, else the latest) is checked out and its content.zip unpacked, its own dependencies
          // installed, then it is published. Nothing is built.
          script: ['apk add --no-cache py3-pip', `python3 ${CRE_SCRIPTS}/build/publish.py prepare`, 'yarn install --immutable',
            'npx projen publish:upload'],
        },
      },
    },
  });
}
