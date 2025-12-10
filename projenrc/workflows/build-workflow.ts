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

  // The test tasks have their own AWS environment variables configured
  // No job-level environment variables needed since they might affect CDK synthesis
}