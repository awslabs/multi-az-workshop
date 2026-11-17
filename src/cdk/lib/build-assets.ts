// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as path from 'path';
import { buildOutputAsset } from '@cre/constructs';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import { Construct } from 'constructs';

/**
 * Where the build (`npx projen build:assets`) writes the container image tarballs and Helm charts
 * that CreEcrImport loads into ECR. Outside assets/, so each one is uploaded once, as its CDK asset.
 */
export const ECR_IMPORT_DIR = path.join('dist', 'ecr-import');

/** An S3 asset of a file build:assets makes (`ECR_IMPORT_DIR/<file>`): a placeholder in the plan synth and jest. */
export function builtAsset(scope: Construct, id: string, file: string): Asset {
  return buildOutputAsset(scope, id, path.join(ECR_IMPORT_DIR, file), { builtBy: 'build:assets' });
}
