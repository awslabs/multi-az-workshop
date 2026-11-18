import { gitlab } from 'projen';
import type { Project } from 'projen';
import { GithubWorkflow } from 'projen/lib/github';
import type { GitHub } from 'projen/lib/github';
import { JobPermission } from 'projen/lib/github/workflows-model';
import type { JobStep } from 'projen/lib/github/workflows-model';
import { projenJobSetup, secretsEnv } from './actions';
import { addGithubApproval } from './approval';

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
  wf.on({ workflowDispatch: {} });
  const approved = approval ? [addGithubApproval(wf)] : [];
  wf.addJob('publish', {
    ...(approved.length ? { needs: approved } : {}),
    if: "github.ref == 'refs/heads/main'",
    runsOn: ['ubuntu-24.04-arm'],
    permissions: { contents: JobPermission.READ },
    env: { CI: 'true', WORKSHOP_ID: '${{ vars.WORKSHOP_ID }}' },
    steps: [
      // The whole history: publish.py checks the commit is on origin/main.
      ...projenJobSetup(true),
      // What the build needs, as the PR build and the deploy have it (buildSetup).
      ...preBuildSteps,
      // Each step gets only the secrets it reads: the build its tool's location, the upload the
      // workshop's credentials and targets (no install, build or third-party step sees those).
      { name: 'Build', run: 'npx projen build', env: secretsEnv(buildToolSecrets) },
      { name: 'Publish', run: 'npx projen publish:upload', env: secretsEnv(PUBLISH_SECRETS) },
    ],
  });
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
          script: ['apk add --no-cache py3-pip', ...buildSetup, 'npx projen publish'],
        },
      },
    },
  });
}
