// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { AwsCdkTypeScriptApp } from 'projen/lib/awscdk';

/**
 * Creates publishing-related tasks for the multi-az-workshop project.
 *
 * Environment variables required:
 * - ASSETS_LOCATION: S3 URI for workshop assets
 * - REMOTE_REPO: Workshop Studio git repository URL
 * - EMAIL: Git commit email
 * - USER_NAME: Git commit author name
 * - GIT_PLUGIN_LOCATION: Private PyPI host for Workshop Studio git plugin
 * - GIT_PLUGIN: Package name of the git plugin
 * - AWS credentials (via environment or role)
 */
export function createPublishTasks(project: AwsCdkTypeScriptApp): void {
  createUploadAssetsTask(project);
  createPushWorkshopTask(project);
  createMainPublishTask(project);
}

function createUploadAssetsTask(project: AwsCdkTypeScriptApp): void {
  project.addTask('publish:upload-assets', {
    description: 'Upload workshop assets to S3 (requires ASSETS_LOCATION, AWS credentials)',
    steps: [
      { exec: 'rm -rf tmp && mkdir -p tmp' },
      { exec: 'unzip -q dist/content.zip -d tmp' },
      { exec: 'cp dist/content.zip tmp/' },
      { exec: 'aws s3 sync tmp "$ASSETS_LOCATION" --delete' },
      { exec: 'rm -rf tmp' },
    ],
  });
}

function createPushWorkshopTask(project: AwsCdkTypeScriptApp): void {
  project.addTask('publish:push-workshop', {
    description: 'Push workshop content to Workshop Studio repository (requires REMOTE_REPO, EMAIL, USER_NAME, GIT_PLUGIN_LOCATION, GIT_PLUGIN)',
    steps: [
      {
        exec: [
          'pip config set global.trusted-host "$GIT_PLUGIN_LOCATION"',
          'pip install --index-url https://"$GIT_PLUGIN_LOCATION" "$GIT_PLUGIN"',
          'git config --global user.email "$EMAIL"',
          'git config --global user.name "$USER_NAME"',
        ].join(' && '),
      },
      { exec: 'git clone --branch mainline "$REMOTE_REPO" tmp/workshop-repo' },
      { exec: 'find tmp/workshop-repo -path tmp/workshop-repo/.git -prune -o ! -name . ! -name .. -exec rm -rf {} + 2>/dev/null || true' },
      { exec: 'cp -r content tmp/workshop-repo/' },
      { exec: 'cp -r static tmp/workshop-repo/' },
      { exec: 'cp contentspec.yaml tmp/workshop-repo/' },
      {
        exec: [
          'cd tmp/workshop-repo',
          'git add -A',
          'git commit -m "Published from release ${RELEASE_TAG:-unknown}" || echo "No changes to commit"',
          'git push || echo "Nothing to push"',
        ].join(' && '),
      },
      { exec: 'rm -rf tmp' },
    ],
  });
}

function createMainPublishTask(project: AwsCdkTypeScriptApp): void {
  const publishTask = project.addTask('publish', {
    description: 'Publish workshop content to S3 and Workshop Studio',
  });
  publishTask.spawn(project.tasks.tryFind('publish:upload-assets')!);
  publishTask.spawn(project.tasks.tryFind('publish:push-workshop')!);
}
