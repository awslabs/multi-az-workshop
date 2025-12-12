import { AwsCdkTypeScriptApp } from 'projen/lib/awscdk';

/**
 * Creates publishing-related tasks for the multi-az-workshop project.
 *
 * This module provides tasks for publishing workshop content to S3 and Workshop Studio,
 * including asset uploads and repository management.
 *
 * @param project - The projen AwsCdkTypeScriptApp project instance
 */
export function createPublishTasks(project: AwsCdkTypeScriptApp): void {
  createUploadAssetsTask(project);
  createPushWorkshopTask(project);
  createMainPublishTask(project);
}

/**
 * Creates the publish:upload-assets task that uploads content to Workshop Studio S3 bucket.
 *
 * This task:
 * - Extracts content from dist/content.zip
 * - Uploads to Workshop Studio S3 bucket
 *
 * Requirements: 4.1, 4.2
 */
function createUploadAssetsTask(project: AwsCdkTypeScriptApp): void {
  project.addTask('publish:upload-assets', {
    description: 'Upload workshop assets to Workshop Studio S3 bucket (requires AWS credentials)',
    steps: [
      {
        say: 'Preparing assets for upload...',
      },
      {
        exec: 'rm -rf tmp && mkdir -p tmp',
      },
      {
        exec: 'unzip -q dist/content.zip -d tmp',
      },
      {
        say: 'Uploading assets to S3...',
      },
      {
        exec: 'aws s3 cp tmp s3://ws-assets-prod-iad-r-iad-ed304a55c2ca1aee.s3.us-east-1.amazonaws.com/public/$WORKSHOP_ID/ --recursive',
      },
      {
        say: 'Asset upload complete!',
      },
      {
        exec: 'rm -rf tmp',
      },
    ],
  });
}

/**
 * Creates the publish:push-workshop task that pushes content to Workshop Studio repository.
 *
 * This task:
 * - Clones Workshop Studio repository
 * - Copies content, static files, and contentspec.yaml
 * - Checks for changes with git diff
 * - Commits and pushes only if changes exist
 *
 * Requirements: 4.3, 4.4, 4.5, 4.6, 4.7
 */
function createPushWorkshopTask(project: AwsCdkTypeScriptApp): void {
  project.addTask('publish:push-workshop', {
    description: 'Push workshop content to Workshop Studio repository (requires REMOTE_REPO, EMAIL, USER_NAME env vars)',
    steps: [
      {
        say: 'Preparing to push to Workshop Studio...',
      },
      {
        exec: 'rm -rf tmp && mkdir -p tmp',
      },
      {
        say: 'Cloning Workshop Studio repository...',
      },
      {
        exec: 'git clone $REMOTE_REPO tmp/workshop-studio',
      },
      {
        say: 'Copying workshop content...',
      },
      {
        exec: 'rm -rf tmp/workshop-studio/content tmp/workshop-studio/static',
      },
      {
        exec: 'cp -r content tmp/workshop-studio/',
      },
      {
        exec: 'cp -r static tmp/workshop-studio/',
      },
      {
        exec: 'cp contentspec.yaml tmp/workshop-studio/',
      },
      {
        say: 'Checking for changes...',
      },
      {
        exec: `
        cd tmp/workshop-studio
        git config user.email "$EMAIL"
        git config user.name "$USER_NAME"
        git add .
        
        # Check if there are any changes to commit
        if git diff --staged --quiet; then
          echo "No changes to commit - skipping push"
        else
          echo "Changes detected - committing and pushing"
          COMMIT_SHA=$(git rev-parse HEAD)
          git commit -m "Update workshop content from commit $COMMIT_SHA"
          git push
          echo "Successfully pushed changes to Workshop Studio"
        fi
      `.trim(),
      },
      {
        say: 'Workshop Studio push complete!',
      },
      {
        exec: 'rm -rf tmp',
      },
    ],
  });
}

/**
 * Creates the main publish task that orchestrates upload and push operations.
 *
 * This task spawns both upload and push tasks in sequence.
 *
 * Requirements: 9.2
 */
function createMainPublishTask(project: AwsCdkTypeScriptApp): void {
  const publishTask = project.addTask('publish', {
    description: 'Publish workshop content to S3 and Workshop Studio (requires WORKSHOP_ID, REMOTE_REPO, EMAIL, USER_NAME, AWS credentials)',
  });

  // Spawn upload task first, then push task
  // Projen's spawn mechanism automatically stops on failure
  publishTask.spawn(project.tasks.tryFind('publish:upload-assets')!);
  publishTask.spawn(project.tasks.tryFind('publish:push-workshop')!);
}
