#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { MultiAZWorkshopStack } from './lib/multi-az-workshop-stack';

const app = new cdk.App();

new MultiAZWorkshopStack(app, 'multi-az-workshop', {
  stackName: 'multi-az-workshop',
  env: {
    region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION,
  },
  synthesizer: new cdk.DefaultStackSynthesizer({
    fileAssetsBucketName: '${AssetsBucketName}',
    bucketPrefix: '${AssetsBucketPrefix}',
  }),
});

app.synth();
