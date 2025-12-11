import { AwsCdkTypeScriptApp } from 'projen/lib/awscdk';

/**
 * Creates deployment-related tasks for the multi-az-workshop project.
 *
 * This module provides tasks for deploying the workshop infrastructure to AWS,
 * including CloudFormation stack management, S3 asset uploads, and cleanup logic.
 *
 * @param project - The projen AwsCdkTypeScriptApp project instance
 */
export function createDeployTasks(project: AwsCdkTypeScriptApp): void {
  createWorkshopDeployTask(project);
  createMainDeployTask(project);
  createBuildAndDeployShortcut(project);
}

/**
 * Creates the deploy:workshop task that handles the complete deployment workflow.
 *
 * This task:
 * - Extracts content.zip to a temporary directory
 * - Uploads assets to S3 with a timestamp prefix
 * - Determines if the CloudFormation stack exists (CREATE vs UPDATE)
 * - Creates and executes a CloudFormation changeset
 * - Waits for stack completion
 * - Cleans up old S3 content on success
 * - Cleans up new S3 content on failure
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9
 */
function createWorkshopDeployTask(project: AwsCdkTypeScriptApp): void {
  project.addTask('deploy:workshop', {
    description: 'Deploy workshop to AWS using CloudFormation (requires BUCKET and AWS_REGION env vars)',
    steps: [
      {
        say: 'Preparing deployment...',
      },
      {
        exec: 'rm -rf tmp && mkdir -p tmp',
      },
      {
        exec: 'unzip -q dist/content.zip -d tmp',
      },
      {
        say: 'Setting deployment timestamp...',
      },
      {
        exec: 'date --utc +"%Y-%m-%dT%H-%M-%SZ" > tmp/assets_prefix.txt',
      },
      {
        say: 'Uploading assets to S3...',
      },
      {
        exec: 'aws s3 cp tmp s3://${BUCKET}/$(cat tmp/assets_prefix.txt)/ --recursive',
      },
      {
        say: 'Determining stack status...',
      },
      {
        exec: `
        set +e
        aws cloudformation describe-stacks --stack-name $PROJECT_NAME --region $AWS_REGION >/dev/null 2>&1
        EXITCODE=$?
        set -e

        if [ $EXITCODE -eq 0 ]; then
          echo "UPDATE" > tmp/change_set_type.txt
          echo "update" > tmp/wait_condition.txt
          echo "Stack exists - will UPDATE"
        else
          echo "CREATE" > tmp/change_set_type.txt
          echo "create" > tmp/wait_condition.txt
          echo "Stack does not exist - will CREATE"
        fi
      `.trim(),
      },
      {
        say: 'Deploying CloudFormation stack...',
      },
      {
        exec: `
        # Load variables from files
        ASSETS_PREFIX=$(cat tmp/assets_prefix.txt)
        CHANGE_SET_TYPE=$(cat tmp/change_set_type.txt)
        WAIT_CONDITION=$(cat tmp/wait_condition.txt)

        # Create changeset with error handling
        if ! aws cloudformation create-change-set \\
          --change-set-type $CHANGE_SET_TYPE \\
          --stack-name $PROJECT_NAME \\
          --change-set-name $PROJECT_NAME-$ASSETS_PREFIX \\
          --template-url https://$BUCKET.s3.$AWS_REGION.amazonaws.com/$ASSETS_PREFIX/$PROJECT_NAME.json \\
          --parameters \\
            ParameterKey=AssetsBucketName,ParameterValue=$BUCKET \\
            ParameterKey=AssetsBucketPrefix,ParameterValue="$ASSETS_PREFIX/" \\
          --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \\
          --region $AWS_REGION; then
          echo "Failed to create changeset - cleaning up S3 content"
          aws s3 rm s3://$BUCKET/$ASSETS_PREFIX/ --recursive
          exit 1
        fi

        # Wait for changeset creation
        if ! aws cloudformation wait change-set-create-complete \\
          --stack-name $PROJECT_NAME \\
          --change-set-name $PROJECT_NAME-$ASSETS_PREFIX \\
          --region $AWS_REGION; then
          echo "Changeset creation failed - cleaning up S3 content"
          aws s3 rm s3://$BUCKET/$ASSETS_PREFIX/ --recursive
          exit 1
        fi

        # Execute changeset
        if ! aws cloudformation execute-change-set \\
          --stack-name $PROJECT_NAME \\
          --change-set-name $PROJECT_NAME-$ASSETS_PREFIX \\
          --region $AWS_REGION; then
          echo "Failed to execute changeset - cleaning up S3 content"
          aws s3 rm s3://$BUCKET/$ASSETS_PREFIX/ --recursive
          exit 1
        fi

        # Wait for stack completion
        if ! aws cloudformation wait stack-$WAIT_CONDITION-complete \\
          --stack-name $PROJECT_NAME \\
          --region $AWS_REGION; then
          echo "Stack deployment failed - cleaning up S3 content"
          aws s3 rm s3://$BUCKET/$ASSETS_PREFIX/ --recursive
          exit 1
        fi
      `.trim(),
      },
      {
        say: 'Deployment succeeded!',
      },
      {
        exec: `
        ASSETS_PREFIX=$(cat tmp/assets_prefix.txt)
        echo "Cleaning up old S3 content due to successful deployment"
        aws s3 rm s3://$BUCKET/ --recursive --exclude "$ASSETS_PREFIX/*"
      `.trim(),
      },
      {
        say: 'Deployment complete!',
      },
    ],
  });
}

/**
 * Creates the main deploy task that spawns deploy:workshop.
 *
 * This task serves as the primary entry point for deployment operations.
 *
 * Requirements: 9.2
 */
function createMainDeployTask(project: AwsCdkTypeScriptApp): void {
  // Check if deploy task already exists (CDK projects have a native deploy task)
  let deployTask = project.tasks.tryFind('deploy');

  if (!deployTask) {
    // Create deploy task if it doesn't exist
    deployTask = project.addTask('deploy', {
      description: 'Deploy workshop to AWS (requires BUCKET and AWS_REGION environment variables)',
    });
  } else {
    // Reset existing deploy task to override CDK's default behavior
    deployTask.reset();
    // Update description
    deployTask.description = 'Deploy workshop to AWS (requires BUCKET and AWS_REGION environment variables)';
  }

  deployTask.spawn(project.tasks.tryFind('deploy:workshop')!);
}

/**
 * Creates the build-and-deploy shortcut task.
 *
 * This task runs a streamlined build (without tests) followed by the deploy task.
 * Tests are skipped since they should have already been run in the CI pipeline.
 * If either task fails, execution stops and the error is propagated.
 *
 * Requirements: 5.1, 5.3
 */
function createBuildAndDeployShortcut(project: AwsCdkTypeScriptApp): void {
  const buildAndDeployTask = project.addTask('build-and-deploy', {
    description: 'Build and deploy workshop to AWS (requires BUCKET and AWS_REGION environment variables)',
  });

  // Run streamlined build steps (skip tests since they run in CI)
  buildAndDeployTask.spawn(project.tasks.tryFind('default')!);
  buildAndDeployTask.spawn(project.tasks.tryFind('pre-compile')!);
  buildAndDeployTask.spawn(project.tasks.tryFind('compile')!);
  buildAndDeployTask.spawn(project.tasks.tryFind('post-compile')!);
  // Skip 'test' step - tests already run in CI
  buildAndDeployTask.spawn(project.tasks.tryFind('package')!);

  // Then deploy
  buildAndDeployTask.spawn(project.tasks.tryFind('deploy')!);
}
