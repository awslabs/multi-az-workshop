/**
 * Build workflow configuration
 * Handles building and testing on pull requests
 */

import { GithubWorkflow } from 'projen/lib/github';
import type { GitHub } from 'projen/lib/github';
import { JobPermission } from 'projen/lib/github/workflows-model';

/**
 * Creates the build workflow with AWS metadata endpoint disabled
 * @param github The GitHub project instance
 */
export function createBuildWorkflow(github: GitHub): void {
  const buildWorkflow = new GithubWorkflow(github, 'build');

  buildWorkflow.on({
    pullRequest: {},
    workflowDispatch: {},
  });

  buildWorkflow.addJob('build', {
    runsOn: ['ubuntu-24.04-arm'],
    permissions: {
      contents: JobPermission.WRITE,
    },
    outputs: {
      self_mutation_happened: {
        stepId: 'self_mutation',
        outputName: 'self_mutation_happened',
      },
    },
    env: {
      CI: 'true',
      AWS_EC2_METADATA_DISABLED: 'true', // Prevent AWS SDK from trying to access metadata endpoint
    },
    steps: [
      {
        name: 'Checkout',
        uses: 'actions/checkout@v4',
        with: {
          ref: '${{ github.event.pull_request.head.ref }}',
          repository: '${{ github.event.pull_request.head.repo.full_name }}',
        },
      },
      {
        name: 'Install dependencies',
        run: 'yarn install --check-files --frozen-lockfile',
      },
      {
        name: 'Install dotnet',
        uses: 'actions/setup-dotnet@v4',
        with: {
          'dotnet-version': '9.0',
        },
      },
      {
        name: 'build',
        run: 'npx projen build',
      },
      {
        name: 'Find mutations',
        id: 'self_mutation',
        run: [
          'git add .',
          'git diff --staged --patch --exit-code > repo.patch || echo "self_mutation_happened=true" >> $GITHUB_OUTPUT',
        ].join('\n'),
        workingDirectory: './',
      },
      {
        name: 'Upload patch',
        if: 'steps.self_mutation.outputs.self_mutation_happened',
        uses: 'actions/upload-artifact@v4.4.0',
        with: {
          name: 'repo.patch',
          path: 'repo.patch',
          overwrite: true,
        },
      },
      {
        name: 'Fail build on mutation',
        if: 'steps.self_mutation.outputs.self_mutation_happened',
        run: [
          'echo "::error::Files were changed during build (see build log). If this was triggered from a fork, you will need to update your branch."',
          'cat repo.patch',
          'exit 1',
        ].join('\n'),
      },
    ],
  });
}
