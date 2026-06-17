// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Deploy workflow configuration
 *
 * Triggered by:
 *  - push to main: automatic deploy after PR merge
 *  - workflow_dispatch: manual deploys
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
    workflowDispatch: {},
    push: { branches: ['main'], paths: ['src/**'] },
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
    ],
  });
}
