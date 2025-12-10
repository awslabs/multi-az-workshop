#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { MultiAZWorkshopStack } from './lib/multi-az-workshop-stack';
import { EvacuationMethod } from './lib/types';

const app = new cdk.App({
  context: {
    evacuationMethod: EvacuationMethod.ZonalShift,
  },
  analyticsReporting: false,
});

new MultiAZWorkshopStack(app, 'multi-az-workshop', {
  stackName: 'multi-az-workshop',
  synthesizer: new cdk.DefaultStackSynthesizer({
    fileAssetsBucketName: '${AssetsBucketName}',
    bucketPrefix: '${AssetsBucketPrefix}',
    qualifier: undefined,
  }),
});

app.synth();
