/**
 * Build workflow customization
 * Customizes projen's native build workflow to add AWS_EC2_METADATA_DISABLED environment variable
 */

import type { AwsCdkTypeScriptApp } from 'projen/lib/awscdk';

/**
 * Customizes the native build workflow to disable AWS EC2 metadata service access
 * @param project The AwsCdkTypeScriptApp project instance
 */
export function customizeBuildWorkflow(project: AwsCdkTypeScriptApp): void {
  // Get the build workflow from GitHub workflows
  const buildWorkflow = project.github?.tryFindWorkflow('build');

  if (!buildWorkflow) {
    console.warn('Build workflow not found. Make sure buildWorkflow is enabled in project configuration.');
    return;
  }

  // Add AWS environment variables to prevent credential lookup failures in tests
  // This prevents the AWS SDK from trying to access the metadata endpoint and provides fake credentials
  if (buildWorkflow.file) {
    buildWorkflow.file.addOverride('jobs.build.env.AWS_EC2_METADATA_DISABLED', 'true');
    buildWorkflow.file.addOverride('jobs.build.env.AWS_ACCESS_KEY_ID', 'fake');
    buildWorkflow.file.addOverride('jobs.build.env.AWS_SECRET_ACCESS_KEY', 'fake');
    buildWorkflow.file.addOverride('jobs.build.env.AWS_DEFAULT_REGION', 'us-east-1');
  }
}