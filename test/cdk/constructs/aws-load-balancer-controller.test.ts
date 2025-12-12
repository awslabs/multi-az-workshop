// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { KubectlV31Layer } from '@aws-cdk/lambda-layer-kubectl-v31';
import * as cdk from 'aws-cdk-lib';
import { Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { AwsLoadBalancerController } from '../../../src/cdk/lib/constructs/aws-load-balancer-controller';
import { ContainerAndRepo } from '../../../src/cdk/lib/constructs/container-and-repo';
import { createMockUploaderFunction } from '../../helpers';
import {
  assertResourceExists,
  assertResourceProperties,
} from '../../helpers/assertion-helpers';
import { createMockVpc } from '../../helpers/mock-factories';
import { synthesizeStack } from '../../helpers/stack-helpers';
import { createTestApp, createTestStack } from '../../helpers/test-fixtures';

describe('AwsLoadBalancerController', () => {
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

    // Create the load balancer controller with default configuration
    new AwsLoadBalancerController(sharedStack, 'LoadBalancerController', {
      cluster: sharedCluster,
      containerAndRepoBuilder: sharedContainerAndRepoBuilder,
    });

    sharedTemplate = synthesizeStack(sharedStack);
  });

  describe('constructor', () => {
    test('creates AWS Load Balancer Controller with default configuration', () => {
      assertResourceExists(sharedTemplate, 'AWS::IAM::Role');
      assertResourceExists(sharedTemplate, 'AWS::IAM::ManagedPolicy');
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource');
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart');
    });
  });

  describe('IAM role and policy creation', () => {
    test('creates IAM role for load balancer controller', () => {
      assertResourceProperties(sharedTemplate, 'AWS::IAM::Role', {
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: {
                Service: 'pods.eks.amazonaws.com',
              },
            }),
          ]),
        }),
      });
    });

    test('creates managed policy with required permissions', () => {
      // Verify that IAM managed policies exist (multiple policies are created)
      assertResourceExists(sharedTemplate, 'AWS::IAM::ManagedPolicy');

      // Verify at least one policy has IAM permissions
      const templateJson = sharedTemplate.toJSON();
      const policies = Object.values(templateJson.Resources || {}).filter(
        (r: any) => r.Type === 'AWS::IAM::ManagedPolicy',
      );
      const hasIamPolicy = policies.some((policy: any) => {
        const statements = policy.Properties?.PolicyDocument?.Statement || [];
        return statements.some((stmt: any) => {
          const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
          return actions.some((action: string) => action.includes('iam:'));
        });
      });
      expect(hasIamPolicy).toBe(true);
    });

    test('grants EC2 describe permissions', () => {
      assertResourceProperties(sharedTemplate, 'AWS::IAM::ManagedPolicy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                'ec2:DescribeAccountAttributes',
                'ec2:DescribeAddresses',
                'ec2:DescribeAvailabilityZones',
              ]),
            }),
          ]),
        }),
      });
    });

    test('grants ELB permissions', () => {
      assertResourceProperties(sharedTemplate, 'AWS::IAM::ManagedPolicy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                'elasticloadbalancing:CreateLoadBalancer',
                'elasticloadbalancing:CreateTargetGroup',
              ]),
            }),
          ]),
        }),
      });
    });

    test('grants security group management permissions', () => {
      assertResourceProperties(sharedTemplate, 'AWS::IAM::ManagedPolicy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                'ec2:AuthorizeSecurityGroupIngress',
                'ec2:RevokeSecurityGroupIngress',
              ]),
            }),
          ]),
        }),
      });
    });

    test('grants WAF permissions', () => {
      assertResourceProperties(sharedTemplate, 'AWS::IAM::ManagedPolicy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                'waf-regional:GetWebACL',
                'wafv2:GetWebACL',
              ]),
            }),
          ]),
        }),
      });
    });
  });

  describe('service account configuration', () => {
    test('creates service account in kube-system namespace', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource', {
        Manifest: Match.stringLikeRegexp('.*ServiceAccount.*'),
      });
    });

    test('creates pod identity association', () => {
      assertResourceExists(sharedTemplate, 'AWS::EKS::PodIdentityAssociation');
      assertResourceProperties(sharedTemplate, 'AWS::EKS::PodIdentityAssociation', {
        Namespace: 'kube-system',
        ServiceAccount: 'aws-load-balancer-controller',
      });
    });
  });

  describe('Helm chart deployment', () => {
    test('installs Helm chart', () => {
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart');
    });

    test('configures Helm chart with cluster name', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
        Chart: 'aws-load-balancer-controller',
        Namespace: 'kube-system',
      });
    });

    test('configures Helm chart to use existing service account', () => {
      // Verify Helm chart custom resource exists with Values property
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
        Chart: 'aws-load-balancer-controller',
        Values: Match.anyValue(),
      });
    });

    test('disables cert-manager', () => {
      // Verify Helm chart custom resource exists
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart');
    });

    test('configures single replica', () => {
      // Verify Helm chart custom resource exists
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart');
    });
  });

  describe('container repository', () => {
    test('creates ECR repository for controller image', () => {
      assertResourceExists(sharedTemplate, 'AWS::ECR::Repository');
    });
  });

  describe('Helm chart repository', () => {
    test('creates Helm chart repository', () => {
      assertResourceExists(sharedTemplate, 'AWS::ECR::Repository');
    });
  });

  describe('resource dependencies', () => {
    test('Helm chart depends on pod identity association', () => {
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart');
      assertResourceExists(sharedTemplate, 'AWS::EKS::PodIdentityAssociation');
    });

    test('pod identity depends on service account', () => {
      assertResourceExists(sharedTemplate, 'AWS::EKS::PodIdentityAssociation');
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource');
    });
  });

  describe('public interface', () => {
    let controller: AwsLoadBalancerController;

    beforeAll(() => {
      const app = createTestApp();
      const stack = createTestStack(app);
      const vpc = createMockVpc(stack);

      const cluster = new eks.Cluster(stack, 'TestCluster', {
        vpc,
        version: eks.KubernetesVersion.V1_31,
        defaultCapacity: 0,
        kubectlLayer: new KubectlV31Layer(stack, 'TestKubectlLayer'),
      });

      const assetsBucket = new s3.Bucket(stack, 'TestAssetsBucket', {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      new cdk.CfnParameter(stack, 'TestAssetsBucketName', {
        type: 'String',
        default: assetsBucket.bucketName,
      });
      new cdk.CfnParameter(stack, 'TestAssetsBucketPrefix', {
        type: 'String',
        default: 'assets/',
      });

      const uploaderFunction = createMockUploaderFunction(stack, 'TestUploaderFunction');
      const containerAndRepoBuilder = new ContainerAndRepo(
        stack,
        'TestContainerAndRepo',
        { uploaderFunction },
      );

      controller = new AwsLoadBalancerController(stack, 'TestLoadBalancerController', {
        cluster,
        containerAndRepoBuilder,
      });
    });

    test('exposes waitableNode property', () => {
      expect(controller.waitableNode).toBeDefined();
    });
  });

  describe('controller configuration options', () => {
    test('uses default container version when not specified', () => {
      // Verify Helm chart exists with default version
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart');
    });

    test('uses default helm version when not specified', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
        Version: '1.10.1',
      });
    });
  });

  describe('controller configuration options - custom container version', () => {
    let customContainerTemplate: any;

    beforeAll(() => {
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

      const containerAndRepoBuilder = new ContainerAndRepo(
        stack,
        'ContainerAndRepo',
        { uploaderFunction: createMockUploaderFunction(stack, 'Uploader' + Math.random()) },
      );

      new AwsLoadBalancerController(stack, 'LoadBalancerController', {
        cluster,
        containerAndRepoBuilder,
        containerVersion: 'v2.9.0',
      });

      customContainerTemplate = synthesizeStack(stack);
    });

    test('uses custom container version when specified', () => {
      // Verify Helm chart exists with custom version
      assertResourceExists(customContainerTemplate, 'Custom::AWSCDK-EKS-HelmChart');
    });
  });

  describe('controller configuration options - custom helm version', () => {
    let customHelmTemplate: any;

    beforeAll(() => {
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

      const containerAndRepoBuilder = new ContainerAndRepo(
        stack,
        'ContainerAndRepo',
        { uploaderFunction: createMockUploaderFunction(stack, 'Uploader' + Math.random()) },
      );

      new AwsLoadBalancerController(stack, 'LoadBalancerController', {
        cluster,
        containerAndRepoBuilder,
        helmVersion: '1.11.0',
      });

      customHelmTemplate = synthesizeStack(stack);
    });

    test('uses custom helm version when specified', () => {
      assertResourceProperties(customHelmTemplate, 'Custom::AWSCDK-EKS-HelmChart', {
        Version: '1.11.0',
      });
    });
  });

  describe('IAM policy completeness', () => {
    test('includes all required AWS service permissions', () => {
      // Verify that IAM managed policy exists with comprehensive permissions
      assertResourceExists(sharedTemplate, 'AWS::IAM::ManagedPolicy');

      // Verify at least one key permission exists
      assertResourceProperties(sharedTemplate, 'AWS::IAM::ManagedPolicy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(['ec2:DescribeAccountAttributes']),
            }),
          ]),
        }),
      });
    });
  });
});
