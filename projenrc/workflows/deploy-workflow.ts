// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Deploy workflow configuration
 *
 * Triggered by:
 *  - push to main: automatic deploy after PR merge
 *  - workflow_dispatch: manual deploys
 *
 * With teardownAfterDeploy (cre-demo-template's option, copied): a stack that stays deployed ages
 * into out-of-SLA findings (the April 2026 stack sat for seven months), so every deploy that
 * succeeded deletes the stack again, unless a manual run sets `keep`, and a `teardown` workflow
 * deletes a kept one, at the latest on Monday. Both call `destroy:workshop` and share the `deploy`
 * concurrency group, so a teardown never starts in the middle of a deploy.
 *
 * Security model:
 *   Deploy only runs trusted code from main. No PR code ever executes
 *   in the privileged deployment context. The job checks out main,
 *   builds from source, and deploys via CloudFormation with CAPABILITY_IAM.
 */

import { GithubWorkflow } from 'projen/lib/github';
import type { GitHub } from 'projen/lib/github';
import { JobPermission } from 'projen/lib/github/workflows-model';

// Pinned action SHAs
const ACTIONS = {
  checkout: 'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5', // v4
  setupNode: 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020', // v4
  setupDotnet: 'actions/setup-dotnet@67a3573c9a986a3f9c594539f4ab511d57bb3ce9', // v4
  configureAwsCreds: 'aws-actions/configure-aws-credentials@00943011d9042930efac3dcd3a170e4273319bc8', // v5.1.0
};

export interface DeployWorkflowOptions {
  /**
   * Delete the stack again after every deploy that succeeded (the deploy that creates it is the
   * test), unless a manual run sets `keep`; a `teardown` workflow (by hand, and weekly) deletes
   * what a kept run left. The same option as cre-demo-template's project types. @default false
   */
  readonly teardownAfterDeploy?: boolean;
}

export function createDeployWorkflow(github: GitHub, opts: DeployWorkflowOptions = {}): void {
  const workflow = new GithubWorkflow(github, 'deploy');

  workflow.on({
    workflowDispatch: opts.teardownAfterDeploy
      ? { inputs: { keep: { description: 'Keep the stack after the deploy (the teardown workflow deletes it, at the latest on its weekly run)', type: 'boolean', default: 'false' } } }
      : {},
    // build/versions.json too: a version change (the weekly upgrade's included) must deploy.
    push: { branches: ['main'], paths: ['src/**', 'build/versions.json'] },
  });

  workflow.file?.addOverride('concurrency', {
    'group': 'deploy',
    'cancel-in-progress': false,
  });

  workflow.addJob('deploy', {
    runsOn: ['ubuntu-24.04-arm'],
    environment: 'AWS',
    permissions: {
      contents: JobPermission.READ,
      idToken: JobPermission.WRITE,
    },
    env: {
      CI: 'true',
      PROJECT_NAME: '${{ github.event.repository.name }}',
      BUCKET: '${{ secrets.BUCKET }}',
      AWS_REGION: '${{ secrets.AWS_REGION }}',
      DEPLOYMENT_ROLE: '${{ secrets.DEPLOYMENT_ROLE }}',
      CLOUDFORMATION_ROLE: '${{ secrets.CLOUDFORMATION_ROLE }}',
    },
    steps: [
      {
        name: 'Checkout main',
        uses: ACTIONS.checkout,
        with: { ref: 'main' },
      },
      {
        name: 'Setup Node.js',
        uses: ACTIONS.setupNode,
        with: { 'node-version': '20' },
      },
      {
        name: 'Setup .NET',
        uses: ACTIONS.setupDotnet,
        with: { 'dotnet-version': '9.0' },
      },
      { name: 'Enable Corepack', run: 'corepack enable' },
      { name: 'Install dependencies', run: 'yarn install --immutable' },
      { name: 'Build', run: 'npx projen build' },
      {
        name: 'Configure AWS credentials',
        uses: ACTIONS.configureAwsCreds,
        with: {
          'role-to-assume': '${{ env.DEPLOYMENT_ROLE }}',
          'aws-region': '${{ env.AWS_REGION }}',
          'mask-aws-account-id': true,
        },
      },
      {
        name: 'Deploy',
        run: 'npx projen deploy',
      },
      ...(opts.teardownAfterDeploy
        ? [
          // Fresh credentials: the deploy may have used most of the first session, and the delete
          // takes over an hour.
          { name: 'Configure AWS credentials for the teardown', if: KEEP_NOT_SET, uses: ACTIONS.configureAwsCreds, with: TEARDOWN_CREDENTIALS },
          { name: 'Teardown', if: KEEP_NOT_SET, run: 'npx projen destroy:workshop --region ${{ env.AWS_REGION }}' },
        ]
        : []),
    ],
  });

  if (opts.teardownAfterDeploy) createTeardownWorkflow(github);
}

/**
 * After a deploy that succeeded (steps after a failed one don't run: a failed deploy stays up to
 * be diagnosed until the weekly teardown), unless a manual run keeps the stack.
 */
const KEEP_NOT_SET = "!(github.event_name == 'workflow_dispatch' && inputs.keep)";

/** The deploy role, for as long as its delete takes (the role allows TEARDOWN_SESSION_SECONDS). */
const TEARDOWN_SESSION_SECONDS = 10800;
const TEARDOWN_CREDENTIALS = {
  'role-to-assume': '${{ env.DEPLOYMENT_ROLE }}',
  'aws-region': '${{ env.AWS_REGION }}',
  'mask-aws-account-id': true,
  'role-duration-seconds': TEARDOWN_SESSION_SECONDS,
};

/**
 * Deletes a stack a `keep` deploy left: by hand, and every Monday with the dependency upgrade's
 * schedule (as cre-demo-template), so a forgotten stack lives at most a week.
 */
function createTeardownWorkflow(github: GitHub): void {
  const workflow = new GithubWorkflow(github, 'teardown');
  workflow.on({ workflowDispatch: {}, schedule: [{ cron: '0 0 * * 1' }] });
  workflow.file?.addOverride('concurrency', { 'group': 'deploy', 'cancel-in-progress': false });
  workflow.addJob('teardown', {
    runsOn: ['ubuntu-24.04-arm'],
    environment: 'AWS',
    permissions: { contents: JobPermission.READ, idToken: JobPermission.WRITE },
    env: {
      AWS_REGION: '${{ secrets.AWS_REGION }}',
      DEPLOYMENT_ROLE: '${{ secrets.DEPLOYMENT_ROLE }}',
    },
    steps: [
      { name: 'Checkout main', uses: ACTIONS.checkout, with: { ref: 'main' } },
      { name: 'Setup Node.js', uses: ACTIONS.setupNode, with: { 'node-version': '20' } },
      { name: 'Enable Corepack', run: 'corepack enable' },
      { name: 'Install dependencies', run: 'yarn install --immutable' },
      { name: 'Configure AWS credentials', uses: ACTIONS.configureAwsCreds, with: TEARDOWN_CREDENTIALS },
      { name: 'Teardown', run: 'npx projen destroy:workshop --region ${{ env.AWS_REGION }}' },
    ],
  });
}
