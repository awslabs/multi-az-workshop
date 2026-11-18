// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as path from 'path';
import { buildOutputAsset } from '@cre/constructs';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import { Construct } from 'constructs';
import { ECR_IMPORT_DIR } from './asset-files';

/** An S3 asset of a file build:assets makes (`ECR_IMPORT_DIR/<file>`, named in asset-files.ts): a placeholder in the plan synth and jest. */
export function builtAsset(scope: Construct, id: string, file: string): Asset {
  return buildOutputAsset(scope, id, path.join(ECR_IMPORT_DIR, file), { builtBy: 'build:assets' });
}
