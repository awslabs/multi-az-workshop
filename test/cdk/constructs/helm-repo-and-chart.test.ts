// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import { Match } from 'aws-cdk-lib/assertions';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { HelmRepoAndChartConstruct } from '../../../src/cdk/lib/constructs/helm-repo-and-chart';
import { synthesizeStack, getResourceCount, findResourcesByType } from '../../helpers/stack-helpers';
import { createTestApp } from '../../helpers/test-fixtures';

// Concrete implementation for testing the abstract class
class TestHelmRepoAndChart extends HelmRepoAndChartConstruct {
  public testCreateHelmRepoAndChart(name: string, version: string, functionArn: string): ecr.Repository {
    return this.createHelmRepoAndChart(name, version, functionArn);
  }
}

describe('HelmRepoAndChartConstruct', () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let helmConstruct: TestHelmRepoAndChart;

  beforeEach(() => {
    app = createTestApp();
    stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });

    // Add required parameters that the construct expects
    new cdk.CfnParameter(stack, 'AssetsBucketName', {
      type: 'String',
      default: 'test-bucket',
    });
    new cdk.CfnParameter(stack, 'AssetsBucketPrefix', {
      type: 'String',
      default: 'test-prefix/',
    });

    helmConstruct = new TestHelmRepoAndChart(stack, 'HelmConstruct');
  });

  describe('constructor', () => {
    test('creates construct successfully', () => {
      expect(helmConstruct).toBeDefined();
      expect(helmConstruct).toBeInstanceOf(HelmRepoAndChartConstruct);
    });

    test('can be instantiated as abstract base class', () => {
      const construct = new TestHelmRepoAndChart(stack, 'AnotherHelm');
      expect(construct).toBeDefined();
    });
  });

  describe('createHelmRepoAndChart method', () => {
    const testFunctionArn = 'arn:aws:lambda:us-east-1:123456789012:function:test-function';

    test('creates ECR repository', () => {
      helmConstruct.testCreateHelmRepoAndChart('istio-base', '1.0.0', testFunctionArn);

      const template = synthesizeStack(stack);
      const count = getResourceCount(template, 'AWS::ECR::Repository');
      expect(count).toBe(1);
    });

    test('configures repository with correct name', () => {
      helmConstruct.testCreateHelmRepoAndChart('istio-base', '1.0.0', testFunctionArn);

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::ECR::Repository', {
        RepositoryName: 'istio-base',
      });
    });

    test('configures repository removal policy', () => {
      helmConstruct.testCreateHelmRepoAndChart('istio-base', '1.0.0', testFunctionArn);

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::ECR::Repository', {
        EmptyOnDelete: true,
      });
    });

    test('creates custom resource for Helm chart', () => {
      helmConstruct.testCreateHelmRepoAndChart('istio-base', '1.0.0', testFunctionArn);

      const template = synthesizeStack(stack);
      const customResources = findResourcesByType(template, 'AWS::CloudFormation::CustomResource');
      expect(customResources.length).toBe(1);
    });

    test('configures custom resource with Helm type', () => {
      helmConstruct.testCreateHelmRepoAndChart('istio-base', '1.0.0', testFunctionArn);

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
        Type: 'Helm',
      });
    });

    test('configures custom resource with service token', () => {
      helmConstruct.testCreateHelmRepoAndChart('istio-base', '1.0.0', testFunctionArn);

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
        ServiceToken: testFunctionArn,
      });
    });

    test('configures custom resource with bucket reference', () => {
      helmConstruct.testCreateHelmRepoAndChart('istio-base', '1.0.0', testFunctionArn);

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
        Bucket: { Ref: 'AssetsBucketName' },
      });
    });

    test('configures custom resource with repository reference', () => {
      helmConstruct.testCreateHelmRepoAndChart('istio-base', '1.0.0', testFunctionArn);

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
        Repository: Match.objectLike({ Ref: Match.stringLikeRegexp('.*HelmRepo.*') }),
      });
    });

    test('configures custom resource with versioned chart key', () => {
      helmConstruct.testCreateHelmRepoAndChart('istio-base', '1.0.0', testFunctionArn);

      const template = synthesizeStack(stack);
      const customResources = findResourcesByType(template, 'AWS::CloudFormation::CustomResource');
      const helmResource = customResources[0];

      expect(helmResource.Properties.Key).toBeDefined();
      // Key should contain the chart name and version
      const keyValue = helmResource.Properties.Key;
      expect(JSON.stringify(keyValue)).toContain('istio-base');
      expect(JSON.stringify(keyValue)).toContain('1.0.0');
      expect(JSON.stringify(keyValue)).toContain('.tgz');
    });

    test('returns ECR repository', () => {
      const repo = helmConstruct.testCreateHelmRepoAndChart('istio-base', '1.0.0', testFunctionArn);

      expect(repo).toBeDefined();
      expect(repo).toBeInstanceOf(ecr.Repository);
      // Repository name is a CDK token, verify it's defined
      expect(repo.repositoryName).toBeDefined();
    });

    test('creates unique resources for multiple charts', () => {
      helmConstruct.testCreateHelmRepoAndChart('istio-base', '1.0.0', testFunctionArn);
      helmConstruct.testCreateHelmRepoAndChart('istio-istiod', '1.0.0', testFunctionArn);

      const template = synthesizeStack(stack);
      const repoCount = getResourceCount(template, 'AWS::ECR::Repository');
      const customResourceCount = getResourceCount(template, 'AWS::CloudFormation::CustomResource');

      expect(repoCount).toBe(2);
      expect(customResourceCount).toBe(2);
    });

    test('handles different chart versions', () => {
      helmConstruct.testCreateHelmRepoAndChart('istio-base', '1.0.0', testFunctionArn);

      const template = synthesizeStack(stack);
      const customResources = findResourcesByType(template, 'AWS::CloudFormation::CustomResource');
      const keyValue = JSON.stringify(customResources[0].Properties.Key);

      expect(keyValue).toContain('1.0.0');
    });

    test('creates repository with HelmRepo suffix in logical ID', () => {
      helmConstruct.testCreateHelmRepoAndChart('istio-base', '1.0.0', testFunctionArn);

      const template = synthesizeStack(stack);
      const resources = findResourcesByType(template, 'AWS::ECR::Repository');

      expect(resources[0].logicalId).toContain('HelmRepo');
    });

    test('creates custom resource with HelmChart suffix in logical ID', () => {
      helmConstruct.testCreateHelmRepoAndChart('istio-base', '1.0.0', testFunctionArn);

      const template = synthesizeStack(stack);
      const resources = findResourcesByType(template, 'AWS::CloudFormation::CustomResource');

      expect(resources[0].logicalId).toContain('HelmChart');
    });
  });

  describe('chart naming conventions', () => {
    const testFunctionArn = 'arn:aws:lambda:us-east-1:123456789012:function:test-function';

    test('handles chart names with hyphens', () => {
      helmConstruct.testCreateHelmRepoAndChart('istio-base', '1.0.0', testFunctionArn);

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::ECR::Repository', {
        RepositoryName: 'istio-base',
      });
    });

    test('handles simple chart names', () => {
      helmConstruct.testCreateHelmRepoAndChart('nginx', '2.0.0', testFunctionArn);

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::ECR::Repository', {
        RepositoryName: 'nginx',
      });
    });

    test('handles chart names with multiple segments', () => {
      helmConstruct.testCreateHelmRepoAndChart('aws-load-balancer-controller', '1.5.0', testFunctionArn);

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::ECR::Repository', {
        RepositoryName: 'aws-load-balancer-controller',
      });
    });
  });

  describe('version handling', () => {
    const testFunctionArn = 'arn:aws:lambda:us-east-1:123456789012:function:test-function';

    test('handles semantic versions', () => {
      helmConstruct.testCreateHelmRepoAndChart('test-chart', '1.2.3', testFunctionArn);

      const template = synthesizeStack(stack);
      const customResources = findResourcesByType(template, 'AWS::CloudFormation::CustomResource');
      const keyValue = JSON.stringify(customResources[0].Properties.Key);

      expect(keyValue).toContain('1.2.3');
    });

    test('handles versions with pre-release tags', () => {
      helmConstruct.testCreateHelmRepoAndChart('test-chart', '1.0.0-beta', testFunctionArn);

      const template = synthesizeStack(stack);
      const customResources = findResourcesByType(template, 'AWS::CloudFormation::CustomResource');
      const keyValue = JSON.stringify(customResources[0].Properties.Key);

      expect(keyValue).toContain('1.0.0-beta');
    });

    test('handles versions with build metadata', () => {
      helmConstruct.testCreateHelmRepoAndChart('test-chart', '1.0.0+build.123', testFunctionArn);

      const template = synthesizeStack(stack);
      const customResources = findResourcesByType(template, 'AWS::CloudFormation::CustomResource');
      const keyValue = JSON.stringify(customResources[0].Properties.Key);

      expect(keyValue).toContain('1.0.0+build.123');
    });
  });

  describe('resource properties', () => {
    const testFunctionArn = 'arn:aws:lambda:us-east-1:123456789012:function:test-function';

    test('repository has deletion policy', () => {
      helmConstruct.testCreateHelmRepoAndChart('istio-base', '1.0.0', testFunctionArn);

      const template = synthesizeStack(stack);
      const resources = findResourcesByType(template, 'AWS::ECR::Repository');

      expect(resources[0].DeletionPolicy).toBeDefined();
    });

    test('custom resource references parameters', () => {
      helmConstruct.testCreateHelmRepoAndChart('istio-base', '1.0.0', testFunctionArn);

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
        Bucket: { Ref: 'AssetsBucketName' },
        Key: Match.objectLike({
          'Fn::Join': Match.arrayWith([
            Match.arrayWith([{ Ref: 'AssetsBucketPrefix' }]),
          ]),
        }),
      });
    });
  });

  describe('integration scenarios', () => {
    const testFunctionArn = 'arn:aws:lambda:us-east-1:123456789012:function:test-function';

    test('supports creating multiple Helm charts in same construct', () => {
      const repo1 = helmConstruct.testCreateHelmRepoAndChart('chart1', '1.0.0', testFunctionArn);
      const repo2 = helmConstruct.testCreateHelmRepoAndChart('chart2', '2.0.0', testFunctionArn);

      expect(repo1.repositoryName).toBeDefined();
      expect(repo2.repositoryName).toBeDefined();

      const template = synthesizeStack(stack);
      const repoCount = getResourceCount(template, 'AWS::ECR::Repository');
      expect(repoCount).toBe(2);
    });

    test('each chart gets its own custom resource', () => {
      helmConstruct.testCreateHelmRepoAndChart('chart1', '1.0.0', testFunctionArn);
      helmConstruct.testCreateHelmRepoAndChart('chart2', '2.0.0', testFunctionArn);

      const template = synthesizeStack(stack);
      const customResources = findResourcesByType(template, 'AWS::CloudFormation::CustomResource');

      expect(customResources).toHaveLength(2);
      expect(customResources[0].Properties.Repository).toBeDefined();
      expect(customResources[1].Properties.Repository).toBeDefined();
    });
  });
});
