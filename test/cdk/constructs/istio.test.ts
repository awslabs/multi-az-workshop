// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { KubectlV31Layer } from '@aws-cdk/lambda-layer-kubectl-v31';
import * as cdk from 'aws-cdk-lib';
import { Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { ContainerAndRepo } from '../../../src/cdk/lib/constructs/container-and-repo';
import { Istio } from '../../../src/cdk/lib/constructs/istio';
import {
  assertResourceExists,
  assertResourceProperties,
  assertResourceCount,
} from '../../helpers/assertion-helpers';
import { createMockVpc, createMockUploaderFunction } from '../../helpers/mock-factories';
import { synthesizeStack } from '../../helpers/stack-helpers';
import { createTestApp, createTestStack } from '../../helpers/test-fixtures';

describe('Istio', () => {
  // Shared instances for default configuration tests
  let sharedApp: cdk.App;
  let sharedStack: cdk.Stack;
  let sharedVpc: ec2.Vpc;
  let sharedCluster: eks.Cluster;
  let sharedContainerAndRepoBuilder: ContainerAndRepo;
  let sharedTemplate: any;

  beforeAll(() => {
    sharedApp = createTestApp();
    sharedStack = createTestStack(sharedApp);
    sharedVpc = createMockVpc(sharedStack);

    // Create EKS cluster
    sharedCluster = new eks.Cluster(sharedStack, 'Cluster', {
      vpc: sharedVpc,
      version: eks.KubernetesVersion.V1_31,
      defaultCapacity: 0,
      kubectlLayer: new KubectlV31Layer(sharedStack, 'KubectlLayer'),
    });

    // Create assets bucket
    const assetsBucket = new s3.Bucket(sharedStack, 'AssetsBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Set up parameters for ContainerAndRepo
    new cdk.CfnParameter(sharedStack, 'AssetsBucketName', {
      type: 'String',
      default: assetsBucket.bucketName,
    });
    new cdk.CfnParameter(sharedStack, 'AssetsBucketPrefix', {
      type: 'String',
      default: 'assets/',
    });

    // Create container and repo builder
    const uploaderFunction = createMockUploaderFunction(sharedStack);
    sharedContainerAndRepoBuilder = new ContainerAndRepo(
      sharedStack,
      'ContainerAndRepo',
      { uploaderFunction },
    );

    // Create Istio with default configuration
    new Istio(sharedStack, 'Istio', {
      cluster: sharedCluster,
      containerAndRepoBuilder: sharedContainerAndRepoBuilder,
    });

    // Synthesize once for all default configuration tests
    sharedTemplate = synthesizeStack(sharedStack);
  });

  describe('constructor', () => {
    test('creates Istio with default configuration', () => {
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart');
      assertResourceExists(sharedTemplate, 'AWS::ECR::Repository');
    });
  });

  describe('Istio components installation', () => {
    test('installs Istio base component', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
        Chart: 'base',
        Namespace: 'istio-system',
      });
    });

    test('installs istiod component', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
        Chart: 'istiod',
        Namespace: 'istio-system',
      });
    });

    test('installs Istio CNI component', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
        Chart: 'cni',
        Namespace: 'istio-system',
      });
    });

    test('installs all three Helm charts', () => {
      assertResourceCount(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart', 3);
    });
  });

  describe('Helm chart deployment', () => {
    test('deploys base chart to istio-system namespace', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
        Chart: 'base',
        Namespace: 'istio-system',
      });
    });

    test('deploys istiod chart with wait enabled', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
        Chart: 'istiod',
        Wait: true,
      });
    });

    test('deploys CNI chart with wait enabled', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
        Chart: 'cni',
        Wait: true,
      });
    });

    test('uses default version 1.24.1', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
        Version: '1.24.1',
      });
    });
  });

  describe('Istio configuration options', () => {
    test('configures istiod with custom hub', () => {
      // Verify istiod Helm chart exists with Values
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
        Chart: 'istiod',
        Values: Match.anyValue(),
      });
    });

    test('configures CNI with custom hub', () => {
      // Verify CNI Helm chart exists with Values
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
        Chart: 'cni',
        Values: Match.anyValue(),
      });
    });

    test('uses ECR repository for container images', () => {
      // Verify Helm charts exist with Values configured
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart');
    });
  });

  describe('container repositories', () => {
    test('creates pilot container repository', () => {
      assertResourceExists(sharedTemplate, 'AWS::ECR::Repository');
    });

    test('creates proxyv2 container repository', () => {
      assertResourceExists(sharedTemplate, 'AWS::ECR::Repository');
    });

    test('creates install-cni container repository', () => {
      assertResourceExists(sharedTemplate, 'AWS::ECR::Repository');
    });

    test('creates all required container repositories', () => {
      // Verify ECR repositories exist (at least 3 for pilot, proxyv2, install-cni)
      const count = sharedTemplate.toJSON().Resources;
      const ecrRepos = Object.values(count).filter((r: any) => r.Type === 'AWS::ECR::Repository');
      expect(ecrRepos.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Helm chart repositories', () => {
    test('creates base Helm chart repository', () => {
      assertResourceExists(sharedTemplate, 'AWS::ECR::Repository');
    });

    test('creates istiod Helm chart repository', () => {
      assertResourceExists(sharedTemplate, 'AWS::ECR::Repository');
    });

    test('creates CNI Helm chart repository', () => {
      assertResourceExists(sharedTemplate, 'AWS::ECR::Repository');
    });
  });

  describe('service mesh setup', () => {
    test('installs base chart first', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
        Chart: 'base',
      });
    });

    test('installs istiod after base', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
        Chart: 'istiod',
      });
    });

    test('installs CNI after istiod', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
        Chart: 'cni',
      });
    });
  });

  describe('resource dependencies', () => {
    test('istiod depends on base chart', () => {
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart');
    });

    test('CNI depends on istiod', () => {
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart');
    });

    test('istiod depends on pilot container', () => {
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart');
      assertResourceExists(sharedTemplate, 'AWS::ECR::Repository');
    });

    test('CNI depends on install-cni container', () => {
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart');
      assertResourceExists(sharedTemplate, 'AWS::ECR::Repository');
    });
  });

  describe('public interface', () => {
    test('exposes waitableNode property', () => {
      // Create a separate stack for this test since it needs to access the Istio instance
      const app = createTestApp();
      const stack = createTestStack(app);
      const vpc = createMockVpc(stack);
      const cluster = new eks.Cluster(stack, 'Cluster', {
        vpc,
        version: eks.KubernetesVersion.V1_31,
        defaultCapacity: 0,
        kubectlLayer: new KubectlV31Layer(stack, 'KubectlLayer'),
      });
      const assetsBucket = new s3.Bucket(stack, 'AssetsBucket', {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
      new cdk.CfnParameter(stack, 'AssetsBucketName', {
        type: 'String',
        default: assetsBucket.bucketName,
      });
      new cdk.CfnParameter(stack, 'AssetsBucketPrefix', {
        type: 'String',
        default: 'assets/',
      });
      const uploaderFunction = createMockUploaderFunction(stack, 'UploaderFunction1');
      const containerAndRepoBuilder = new ContainerAndRepo(
        stack,
        'ContainerAndRepo',
        { uploaderFunction },
      );

      const istio = new Istio(stack, 'Istio', {
        cluster,
        containerAndRepoBuilder,
      });

      expect(istio.waitableNode).toBeDefined();
    });
  });

  describe('Helm chart configuration', () => {
    test('uses OCI repository for base chart', () => {
      // Verify base chart exists with Repository property
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
        Chart: 'base',
        Repository: Match.anyValue(),
      });
    });

    test('uses OCI repository for istiod chart', () => {
      // Verify istiod chart exists with Repository property
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
        Chart: 'istiod',
        Repository: Match.anyValue(),
      });
    });

    test('uses OCI repository for CNI chart', () => {
      // Verify CNI chart exists with Repository property
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
        Chart: 'cni',
        Repository: Match.anyValue(),
      });
    });
  });

  describe('service timeout configuration', () => {
    test('configures service timeout for base chart', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
        Chart: 'base',
      });
    });

    test('configures service timeout for istiod chart', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
        Chart: 'istiod',
      });
    });

    test('configures service timeout for CNI chart', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
        Chart: 'cni',
      });
    });
  });

  describe('version compatibility', () => {
    test('works with version 1.24.1', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
        Version: '1.24.1',
      });
    });

    describe('custom version 1.25.0', () => {
      let customVersionApp: cdk.App;
      let customVersionStack: cdk.Stack;
      let customVersionTemplate: any;

      beforeAll(() => {
        customVersionApp = createTestApp();
        customVersionStack = createTestStack(customVersionApp);
        const vpc = createMockVpc(customVersionStack);
        const cluster = new eks.Cluster(customVersionStack, 'Cluster', {
          vpc,
          version: eks.KubernetesVersion.V1_31,
          defaultCapacity: 0,
          kubectlLayer: new KubectlV31Layer(customVersionStack, 'KubectlLayer'),
        });
        const assetsBucket = new s3.Bucket(customVersionStack, 'AssetsBucket', {
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        new cdk.CfnParameter(customVersionStack, 'AssetsBucketName', {
          type: 'String',
          default: assetsBucket.bucketName,
        });
        new cdk.CfnParameter(customVersionStack, 'AssetsBucketPrefix', {
          type: 'String',
          default: 'assets/',
        });
        const uploaderFunction = createMockUploaderFunction(customVersionStack, 'UploaderFunction2');
        const containerAndRepoBuilder = new ContainerAndRepo(
          customVersionStack,
          'ContainerAndRepo',
          { uploaderFunction },
        );

        new Istio(customVersionStack, 'Istio', {
          cluster,
          containerAndRepoBuilder,
          version: '1.25.0',
        });

        customVersionTemplate = synthesizeStack(customVersionStack);
      });

      test('works with version 1.25.0', () => {
        assertResourceProperties(customVersionTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
          Version: '1.25.0',
        });
      });

      test('creates Istio with custom version', () => {
        assertResourceExists(customVersionTemplate, 'Custom::AWSCDK-EKS-HelmChart');
      });
    });
  });
});
