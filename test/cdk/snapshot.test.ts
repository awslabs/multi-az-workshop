// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MultiAZWorkshopStack } from '../../src/cdk/lib/multi-az-workshop-stack';

// Mock the file system to provide versions.json
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  const originalReadFileSync = actual.readFileSync;

  return {
    ...actual,
    readFileSync: jest.fn((path: any, options?: any) => {
      if (path.toString().includes('versions.json')) {
        return JSON.stringify({
          EKS: '1.35',
          HELM: '4.1.1',
          KUBECTL: '1.35.0',
          ISTIO: '1.29.0',
          AWS_LOAD_BALANCER_CONTROLLER: '3.0.0',
          POSTGRES: '16.8',
        });
      }
      return originalReadFileSync(path, options);
    }),
  };
});

describe('CloudFormation Template Snapshot', () => {
  let sharedApp: App;
  let sharedStack: MultiAZWorkshopStack;
  let sharedTemplate: Template;

  beforeAll(() => {
    sharedApp = new App();
    sharedStack = new MultiAZWorkshopStack(sharedApp, 'SnapshotTestStack', {
      env: { region: 'us-east-1' },
    });
    sharedTemplate = Template.fromStack(sharedStack);
  });

  test('stack matches snapshot', () => {
    expect(sharedTemplate.toJSON()).toMatchSnapshot();
  });
});
