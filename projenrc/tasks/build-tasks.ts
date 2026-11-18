// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { AwsCdkTypeScriptApp } from 'projen/lib/awscdk';
import { Task } from 'projen/lib/task';
import { ASSETS_DIR, assetFiles } from '../../src/cdk/lib/asset-files';

/**
 * Creates .NET test tasks
 * @param project The AwsCdkTypeScriptApp project instance
 */
function createDotnetTestTasks(project: AwsCdkTypeScriptApp): { unit: Task; integration: Task } {
  const env = {
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_ACCESS_KEY_ID: 'fake',
    AWS_SECRET_ACCESS_KEY: 'fake',
    AWS_DEFAULT_REGION: 'us-east-1',
  };
  const unit = project.addTask('test:app:unit', {
    description: 'Run .NET unit tests',
    env,
    exec: 'dotnet test test/app --filter "FullyQualifiedName!~Integration" --configuration Release --logger "console;verbosity=detailed"',
  });
  const integration = project.addTask('test:app:integration', {
    description: 'Run .NET integration tests',
    env,
    exec: 'dotnet test test/app --filter "FullyQualifiedName~Integration" --configuration Release --logger "console;verbosity=detailed"',
  });
  return { unit, integration };
}

/**
 * The workshop's own build tasks, in the project type's lifecycle:
 *  - compile: every asset (src/cdk/build-assets.ts: the app's images and bundles, the charts and
 *    images for ECR, kubectl and docker compose), after pre-compile emptied assets/, before the
 *    synth that takes the images and charts as CDK assets;
 *  - test: the .NET tests, after jest and eslint;
 *  - package: dist/content.zip is also put in assets/, for the guide's "on your own" download.
 */
export function createBuildTasks(project: AwsCdkTypeScriptApp): void {
  const { unit, integration } = createDotnetTestTasks(project);
  const buildAssets = project.addTask('build:assets', {
    description: 'Build all workshop assets: assets/ (fetched by name) and the ECR images and charts (dist/ecr-import)',
    exec: 'ts-node -P tsconfig.json --prefer-ts-exts src/cdk/build-assets.ts',
  });

  project.compileTask.spawn(buildAssets);

  project.testTask.spawn(unit);
  project.testTask.spawn(integration);

  // Not inside the zip it is a copy of: removed before package:content zips assets/.
  const content = `${ASSETS_DIR}/${assetFiles.content}`;
  project.packageTask.prependExec(`rm -f ${content}`);
  project.packageTask.exec(`cp dist/content.zip ${content}`);
}
