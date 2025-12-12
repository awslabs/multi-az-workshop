// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import { Match } from 'aws-cdk-lib/assertions';
import { NestedStackWithSource } from '../../../src/cdk/lib/constructs/nested-stack-with-source';
import { synthesizeStack, getParameterValue } from '../../helpers/stack-helpers';
import { createTestApp } from '../../helpers/test-fixtures';

describe('NestedStackWithSource', () => {
  let app: cdk.App;
  let parentStack: cdk.Stack;

  beforeEach(() => {
    app = createTestApp();
    parentStack = new cdk.Stack(app, 'ParentStack');

    // Create the required parameters in the parent stack
    new cdk.CfnParameter(parentStack, 'AssetsBucketName', {
      type: 'String',
      minLength: 1,
      description: 'S3 bucket name for assets',
    });

    new cdk.CfnParameter(parentStack, 'AssetsBucketPrefix', {
      type: 'String',
      description: 'S3 bucket prefix for assets',
    });
  });

  describe('constructor', () => {
    test('creates nested stack successfully', () => {
      const nestedStack = new NestedStackWithSource(parentStack, 'NestedStack');

      expect(nestedStack).toBeDefined();
      expect(nestedStack).toBeInstanceOf(cdk.NestedStack);
    });

    test('creates nested stack with custom props', () => {
      const nestedStack = new NestedStackWithSource(parentStack, 'NestedStack', {
        description: 'Test nested stack',
      });

      expect(nestedStack).toBeDefined();
      expect(nestedStack.nestedStackResource).toBeDefined();
    });

    test('creates nested stack without props', () => {
      const nestedStack = new NestedStackWithSource(parentStack, 'NestedStack');

      expect(nestedStack).toBeDefined();
    });
  });

  describe('parameter handling', () => {
    test('creates AssetsBucketName parameter in nested stack', () => {
      const nestedStack = new NestedStackWithSource(parentStack, 'NestedStack');

      expect(nestedStack.assetsBucketName).toBeDefined();
      expect(nestedStack.assetsBucketName).toBeInstanceOf(cdk.CfnParameter);
    });

    test('creates AssetsBucketPrefix parameter in nested stack', () => {
      const nestedStack = new NestedStackWithSource(parentStack, 'NestedStack');

      expect(nestedStack.assetsBucketPrefix).toBeDefined();
      expect(nestedStack.assetsBucketPrefix).toBeInstanceOf(cdk.CfnParameter);
    });

    test('AssetsBucketName parameter has correct type', () => {
      const nestedStack = new NestedStackWithSource(parentStack, 'NestedStack');
      const template = synthesizeStack(nestedStack);

      const param = getParameterValue(template, 'AssetsBucketName');
      expect(param.Type).toBe('String');
    });

    test('AssetsBucketName parameter has minLength constraint', () => {
      const nestedStack = new NestedStackWithSource(parentStack, 'NestedStack');
      const template = synthesizeStack(nestedStack);

      const param = getParameterValue(template, 'AssetsBucketName');
      expect(param.MinLength).toBe(1);
    });

    test('AssetsBucketPrefix parameter has correct type', () => {
      const nestedStack = new NestedStackWithSource(parentStack, 'NestedStack');
      const template = synthesizeStack(nestedStack);

      const param = getParameterValue(template, 'AssetsBucketPrefix');
      expect(param.Type).toBe('String');
    });

    test('propagates parent stack parameters to nested stack', () => {
      new NestedStackWithSource(parentStack, 'NestedStack');

      // Verify the nested stack resource has parameters
      const parentTemplate = synthesizeStack(parentStack);
      parentTemplate.hasResourceProperties('AWS::CloudFormation::Stack', {
        Parameters: {
          AssetsBucketName: Match.anyValue(),
          AssetsBucketPrefix: Match.anyValue(),
        },
      });
    });
  });

  describe('parameter updates', () => {
    test('updates parameters when provided in props', () => {
      new NestedStackWithSource(parentStack, 'NestedStack', {
        parameters: {
          CustomParam: 'CustomValue',
        },
      });

      const parentTemplate = synthesizeStack(parentStack);
      parentTemplate.hasResourceProperties('AWS::CloudFormation::Stack', {
        Parameters: Match.objectLike({
          AssetsBucketName: Match.anyValue(),
          AssetsBucketPrefix: Match.anyValue(),
        }),
      });
    });

    test('merges custom parameters with base parameters', () => {
      new NestedStackWithSource(parentStack, 'NestedStack', {
        parameters: {
          CustomParam: 'CustomValue',
        },
      });

      const parentTemplate = synthesizeStack(parentStack);
      parentTemplate.hasResourceProperties('AWS::CloudFormation::Stack', {
        Parameters: Match.objectLike({
          AssetsBucketName: Match.anyValue(),
          AssetsBucketPrefix: Match.anyValue(),
          CustomParam: 'CustomValue',
        }),
      });
    });
  });

  describe('nested stack resource creation', () => {
    test('creates nested stack resource in parent', () => {
      new NestedStackWithSource(parentStack, 'NestedStack');

      const template = synthesizeStack(parentStack);
      template.hasResourceProperties('AWS::CloudFormation::Stack', {
        Parameters: Match.objectLike({
          AssetsBucketName: Match.anyValue(),
          AssetsBucketPrefix: Match.anyValue(),
        }),
      });
    });

    test('nested stack resource has template URL', () => {
      new NestedStackWithSource(parentStack, 'NestedStack');

      const template = synthesizeStack(parentStack);
      template.hasResourceProperties('AWS::CloudFormation::Stack', {
        TemplateURL: Match.anyValue(),
      });
    });

    test('can create multiple nested stacks', () => {
      new NestedStackWithSource(parentStack, 'NestedStack1');
      new NestedStackWithSource(parentStack, 'NestedStack2');

      const template = synthesizeStack(parentStack);
      const templateJson = template.toJSON();
      const stacks = Object.values(templateJson.Resources || {}).filter(
        (resource: any) => resource.Type === 'AWS::CloudFormation::Stack',
      );

      expect(stacks.length).toBe(2);
    });
  });

  describe('base class functionality', () => {
    test('inherits from NestedStack', () => {
      const nestedStack = new NestedStackWithSource(parentStack, 'NestedStack');

      expect(nestedStack).toBeInstanceOf(cdk.NestedStack);
    });

    test('has nestedStackResource property', () => {
      const nestedStack = new NestedStackWithSource(parentStack, 'NestedStack');

      expect(nestedStack.nestedStackResource).toBeDefined();
    });

    test('has nestedStackParent property', () => {
      const nestedStack = new NestedStackWithSource(parentStack, 'NestedStack');

      expect(nestedStack.nestedStackParent).toBe(parentStack);
    });

    test('can add resources to nested stack', () => {
      const nestedStack = new NestedStackWithSource(parentStack, 'NestedStack');

      new cdk.CfnResource(nestedStack, 'TestResource', {
        type: 'AWS::S3::Bucket',
      });

      const template = synthesizeStack(nestedStack);
      template.hasResource('AWS::S3::Bucket', {});
    });
  });

  describe('parameter references', () => {
    test('parameter values can be referenced in nested stack', () => {
      const nestedStack = new NestedStackWithSource(parentStack, 'NestedStack');

      const bucketNameRef = nestedStack.assetsBucketName.valueAsString;
      const bucketPrefixRef = nestedStack.assetsBucketPrefix.valueAsString;

      expect(bucketNameRef).toBeDefined();
      expect(bucketPrefixRef).toBeDefined();
    });

    test('parameters are accessible as public properties', () => {
      const nestedStack = new NestedStackWithSource(parentStack, 'NestedStack');

      expect(nestedStack.assetsBucketName).toBeDefined();
      expect(nestedStack.assetsBucketPrefix).toBeDefined();
    });
  });
});
