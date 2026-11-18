import { gitlab } from 'projen';
import type { GithubWorkflow } from 'projen/lib/github';
import { ON_MAIN } from './actions';

/**
 * Deploy approval (`deployApproval`): one person approves a run once, before anything reaches AWS
 * or Workshop Studio.
 *
 * GitHub asks for an environment's required reviewers once per job that names it, and the deploy
 * jobs must each name `AWS` (its secrets, and the OIDC subject the runner role trusts). So the
 * approval is its own job, in its own environment, `AWS-approval` (setup makes it, with the person
 * who ran setup as its reviewer, and leaves `AWS` without one), and every job that reaches AWS waits
 * for it. GitLab: a play-button job the deploy jobs wait for (a protected branch's maintainers run it).
 */
export const APPROVAL_ENVIRONMENT = 'AWS-approval';
export const APPROVE_JOB = 'approve';
export const GITLAB_APPROVE_JOB = 'deploy:approve';

/** Adds the approval job to a GitHub workflow; returns its id, for the jobs that wait for it. */
export function addGithubApproval(workflow: GithubWorkflow, needs: string[] = []): string {
  workflow.addJob(APPROVE_JOB, {
    ...(needs.length ? { needs } : {}),
    if: ON_MAIN,
    runsOn: ['ubuntu-latest'],
    environment: { name: APPROVAL_ENVIRONMENT },
    permissions: {},
    steps: [{ name: 'Approved', run: 'echo "Approved."' }],
  });
  return APPROVE_JOB;
}

/** GitLab's approval: a play button in the deploy stage; `allowFailure: false` holds the jobs that need it. */
export function gitlabApprovalJob(onMain: string): gitlab.Job {
  return {
    stage: 'deploy',
    rules: [{ if: onMain, when: gitlab.JobWhen.MANUAL, allowFailure: false }],
    needs: [],
    // Nothing to install: it only waits for the click.
    beforeScript: [],
    cache: [],
    script: ['echo "Approved."'],
  };
}
