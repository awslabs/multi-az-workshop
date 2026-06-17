// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Publish workflow configuration
 * Downloads the latest release and invokes projen publish tasks.
 */

import { GithubWorkflow } from 'projen/lib/github';
import type { GitHub } from 'projen/lib/github';
import { JobPermission } from 'projen/lib/github/workflows-model';

const ACTIONS = {
  checkout: 'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5', // v4
};

export function createPublishWorkflow(github: GitHub): void {
  const workflow = new GithubWorkflow(github, 'publish');

  workflow.on({
    workflowDispatch: {
      inputs: {
        email: {
          type: 'string',
          description: 'The email used for the git commit',
          required: true,
        },
      },
    },
  });

  workflow.addJob('publish', {
    runsOn: ['ubuntu-latest'],
    environment: 'WorkshopStudio',
    permissions: {
      contents: JobPermission.READ,
    },
    env: {
      GH_TOKEN: '${{ github.token }}',
      AWS_DEFAULT_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: '${{ secrets.ACCESS_KEY_ID }}',
      AWS_SECRET_ACCESS_KEY: '${{ secrets.SECRET_KEY }}',
      AWS_SESSION_TOKEN: '${{ secrets.SESSION_TOKEN }}',
      ASSETS_LOCATION: '${{ secrets.ASSETS_LOCATION }}',
      REMOTE_REPO: '${{ secrets.REMOTE_REPO }}',
      GIT_PLUGIN_LOCATION: '${{ secrets.GIT_PLUGIN_LOCATION }}',
      GIT_PLUGIN: '${{ secrets.GIT_PLUGIN }}',
      USER_NAME: '${{ github.triggering_actor }}',
      EMAIL: '${{ inputs.email }}',
    },
    steps: [
      {
        name: 'Checkout',
        uses: ACTIONS.checkout,
      },
      {
        name: 'Download release content',
        run: [
          'RELEASE_TAG=$(gh api repos/${{ github.repository }}/releases/latest --jq .tag_name)',
          'echo "RELEASE_TAG=$RELEASE_TAG" >> "$GITHUB_ENV"',
          'mkdir -p dist',
          'gh release download "$RELEASE_TAG" --repo ${{ github.repository }} --pattern content.zip --dir dist',
        ].join('\n'),
      },
      {
        name: 'Enable Corepack',
        run: 'corepack enable',
      },
      {
        name: 'Install dependencies',
        run: 'yarn install --immutable',
      },
      {
        name: 'Publish',
        run: 'npx projen publish',
      },
    ],
  });
}
