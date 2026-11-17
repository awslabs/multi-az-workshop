import { gitlab } from 'projen';
import type { Project } from 'projen';
import { GithubWorkflow } from 'projen/lib/github';
import type { GitHub } from 'projen/lib/github';
import { JobPermission } from 'projen/lib/github/workflows-model';
import { ACTIONS, NODE_MAJOR } from './actions';
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

export function createGithubPublishWorkflow(github: GitHub, buildToolSecrets: readonly string[], approval = false): void {
  const wf = new GithubWorkflow(github, 'publish');
  wf.on({ workflowDispatch: {} });
  const secret = (k: string) => [k, `\${{ secrets.${k} }}`];
  const approved = approval ? [addGithubApproval(wf)] : [];
  wf.addJob('publish', {
    ...(approved.length ? { needs: approved } : {}),
    if: "github.ref == 'refs/heads/main'",
    runsOn: ['ubuntu-24.04-arm'],
    permissions: { contents: JobPermission.READ },
    env: {
      CI: 'true',
      WORKSHOP_ID: '${{ vars.WORKSHOP_ID }}',
      ...Object.fromEntries([...PUBLISH_SECRETS, ...buildToolSecrets].map(secret)),
    },
    steps: [
      // The whole history: publish.py checks the commit is on origin/main.
      { name: 'Checkout', uses: ACTIONS.checkout, with: { 'ref': '${{ github.sha }}', 'fetch-depth': 0 } },
      { name: 'Setup Node.js', uses: ACTIONS.setupNode, with: { 'node-version': NODE_MAJOR } },
      { name: 'Enable Corepack', run: 'corepack enable' },
      { name: 'Install dependencies', run: 'yarn install --immutable' },
      { name: 'Build and publish', run: 'npx projen publish' },
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
          // The git plugin installs into a virtualenv: pip.
          script: ['apk add --no-cache py3-pip', 'npx projen publish'],
        },
      },
    },
  });
}
