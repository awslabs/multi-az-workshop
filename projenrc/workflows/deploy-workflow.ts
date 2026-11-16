// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Deploy workflow configuration
 *
 * Triggered by:
 *  - push to main: automatic deploy after PR merge, then teardown
 *  - workflow_dispatch: manual deploys; `keep: true` leaves the stack running (an incremental dev
 *    session), for the teardown workflow (by hand, or its weekly run) to delete
 *
 * Teardown: a stack that stays deployed ages into out-of-SLA findings (the April 2026 stack sat
 * for seven months). So every deploy from main deletes the stack again once it deployed (the
 * deploy creating it is the test), and the teardown workflow deletes a kept one, at the latest
 * on Sunday. Both call `destroy:workshop` and share the `deploy` concurrency group, so a teardown
 * never starts in the middle of a deploy.
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

export function createDeployWorkflow(github: GitHub): void {
  const workflow = new GithubWorkflow(github, 'deploy');

  workflow.on({
    workflowDispatch: {
      inputs: {
        keep: { description: 'Leave the stack deployed (delete it later with the teardown workflow)', type: 'boolean', default: 'false' },
      },
    },
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
        id: 'deploy',
        run: 'npx projen deploy',
      },
      // Fresh credentials: the deploy may have used most of the first session, and the delete
      // takes over an hour.
      {
        name: 'Configure AWS credentials for the teardown',
        if: TEARDOWN,
        uses: ACTIONS.configureAwsCreds,
        with: TEARDOWN_CREDENTIALS,
      },
      {
        name: 'Teardown',
        if: TEARDOWN,
        run: 'npx projen destroy:workshop --region ${{ env.AWS_REGION }}',
      },
    ],
  });

  createTeardownWorkflow(github);
}

/**
 * Every deploy tears down, a failed one too, except a manual dispatch with `keep`. A run whose
 * build failed never deployed, so it leaves alone a stack an earlier `keep` run left.
 */
const TEARDOWN = "${{ !cancelled() && steps.deploy.outcome != 'skipped' && !(github.event_name == 'workflow_dispatch' && inputs.keep) }}";

/** The deploy role, for as long as its delete takes (the role allows TEARDOWN_SESSION_SECONDS). */
const TEARDOWN_SESSION_SECONDS = 10800;
const TEARDOWN_CREDENTIALS = {
  'role-to-assume': '${{ env.DEPLOYMENT_ROLE }}',
  'aws-region': '${{ env.AWS_REGION }}',
  'mask-aws-account-id': true,
  'role-duration-seconds': TEARDOWN_SESSION_SECONDS,
};

/**
 * Deletes a stack a `keep` deploy left: by hand, and every Sunday at 06:00 UTC, so a forgotten
 * stack lives at most a week (container findings take weeks to go out of SLA).
 */
function createTeardownWorkflow(github: GitHub): void {
  const workflow = new GithubWorkflow(github, 'teardown');
  workflow.on({ workflowDispatch: {}, schedule: [{ cron: '0 6 * * 0' }] });
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
