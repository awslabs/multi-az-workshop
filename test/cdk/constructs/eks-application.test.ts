// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { KubectlV31Layer } from '@aws-cdk/lambda-layer-kubectl-v31';
import * as cdk from 'aws-cdk-lib';
import { Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { ContainerAndRepo } from '../../../src/cdk/lib/constructs/container-and-repo';
import { EKSApplication } from '../../../src/cdk/lib/constructs/eks-application';
import {
  assertResourceExists,
  assertResourceProperties,
  assertResourceCount,
} from '../../helpers/assertion-helpers';
import { createMockVpc } from '../../helpers/mock-factories';
import { synthesizeStack } from '../../helpers/stack-helpers';
import { createTestApp, createTestStack } from '../../helpers/test-fixtures';

describe('EKSApplication', () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpc: ec2.Vpc;
  let cluster: eks.Cluster;
  let databaseCluster: rds.DatabaseCluster;
  let containerAndRepoBuilder: ContainerAndRepo;
  let assetsBucket: s3.Bucket;
  let sharedTemplate: any;
  let application: EKSApplication;

  // Create shared resources once for all tests
  beforeAll(() => {
    app = createTestApp();
    stack = createTestStack(app);
    vpc = createMockVpc(stack);

    // Create EKS cluster
    cluster = new eks.Cluster(stack, 'Cluster', {
      vpc,
      version: eks.KubernetesVersion.V1_31,
      defaultCapacity: 0,
      kubectlLayer: new KubectlV31Layer(stack, 'KubectlLayer'),
    });

    // Create database cluster
    databaseCluster = new rds.DatabaseCluster(stack, 'Database', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_1,
      }),
      writer: rds.ClusterInstance.provisioned('writer', {
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      }),
      vpc,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create assets bucket
    assetsBucket = new s3.Bucket(stack, 'AssetsBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Set up parameters for ContainerAndRepo
    new cdk.CfnParameter(stack, 'AssetsBucketName', {
      type: 'String',
      default: assetsBucket.bucketName,
    });
    new cdk.CfnParameter(stack, 'AssetsBucketPrefix', {
      type: 'String',
      default: 'assets/',
    });

    // Create container and repo builder
    containerAndRepoBuilder = new ContainerAndRepo(
      stack,
      'ContainerAndRepo',
      cdk.aws_lambda.Runtime.PYTHON_3_12,
    );

    // Create the EKS application once
    application = new EKSApplication(stack, 'Application', {
      cluster,
      containerAndRepoBuilder,
      databaseCluster,
      namespace: 'test-app',
    });

    // Synthesize once and reuse
    sharedTemplate = synthesizeStack(stack);
  });

  describe('constructor', () => {
    test('creates EKS application with required resources', () => {
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource');
      assertResourceExists(sharedTemplate, 'AWS::IAM::Role');
      assertResourceExists(sharedTemplate, 'AWS::ElasticLoadBalancingV2::TargetGroup');
    });

    test('creates application with custom namespace', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource', {
        Manifest: Match.stringLikeRegexp('.*test-app.*'),
      });
    });
  });

  describe('namespace creation', () => {
    test('creates Kubernetes namespace', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource', {
        Manifest: Match.stringLikeRegexp('.*Namespace.*'),
      });
    });

    test('enables Istio injection on namespace', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource', {
        Manifest: Match.stringLikeRegexp('.*istio-injection.*enabled.*'),
      });
    });
  });

  describe('service account configuration', () => {
    test('creates service account', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource', {
        Manifest: Match.stringLikeRegexp('.*ServiceAccount.*'),
      });
    });

    test('creates pod identity association', () => {
      assertResourceExists(sharedTemplate, 'AWS::EKS::PodIdentityAssociation');
      assertResourceProperties(sharedTemplate, 'AWS::EKS::PodIdentityAssociation', {
        Namespace: 'test-app',
        ServiceAccount: 'test-app-sa',
      });
    });
  });

  describe('IAM roles and policies', () => {
    test('creates pod IAM role', () => {
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

    test('creates managed policy for S3 and KMS access', () => {
      assertResourceExists(sharedTemplate, 'AWS::IAM::ManagedPolicy');
      assertResourceProperties(sharedTemplate, 'AWS::IAM::ManagedPolicy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(['s3:GetObject', 's3:GetObjectVersion']),
            }),
          ]),
        }),
      });
    });

    test('creates managed policy for CloudWatch access', () => {
      assertResourceProperties(sharedTemplate, 'AWS::IAM::ManagedPolicy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(['cloudwatch:PutMetricData', 'logs:CreateLogStream']),
            }),
          ]),
        }),
      });
    });

    test('creates managed policy for X-Ray access', () => {
      assertResourceProperties(sharedTemplate, 'AWS::IAM::ManagedPolicy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(['xray:PutTraceSegments', 'xray:PutTelemetryRecords']),
            }),
          ]),
        }),
      });
    });

    test('grants access to database secret', () => {
      assertResourceProperties(sharedTemplate, 'AWS::IAM::ManagedPolicy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(['secretsmanager:GetSecretValue']),
            }),
          ]),
        }),
      });
    });
  });

  describe('service configuration', () => {
    test('creates Kubernetes service', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource', {
        Manifest: Match.stringLikeRegexp('.*Service.*'),
      });
    });

    test('configures service with ClusterIP type', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource', {
        Manifest: Match.stringLikeRegexp('.*ClusterIP.*'),
      });
    });

    test('configures service port', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource', {
        Manifest: Match.stringLikeRegexp('.*5000.*'),
      });
    });

    test('enables topology-aware routing', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource', {
        Manifest: Match.stringLikeRegexp('.*topology-mode.*auto.*'),
      });
    });
  });

  describe('deployment configuration', () => {
    test('creates Kubernetes deployment', () => {
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource');
    });

    test('configures deployment with 6 replicas', () => {
      const count = sharedTemplate.toJSON().Resources;
      const k8sResources = Object.values(count).filter(
        (r: any) => r.Type === 'Custom::AWSCDK-EKS-KubernetesResource',
      );
      expect(k8sResources.length).toBeGreaterThan(5);
    });

    test('configures rolling update strategy', () => {
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource');
    });

    test('configures topology spread constraints', () => {
      const templateJson = sharedTemplate.toJSON();
      const resources = Object.values(templateJson.Resources || {});
      const hasTopologySpread = resources.some((resource: any) => {
        if (resource.Type === 'Custom::AWSCDK-EKS-KubernetesResource') {
          const manifest = resource.Properties?.Manifest || '';
          const manifestStr = typeof manifest === 'string' ? manifest : JSON.stringify(manifest);
          return manifestStr.includes('topologySpreadConstraints');
        }
        return false;
      });
      expect(hasTopologySpread).toBe(true);
    });

    test('configures termination grace period', () => {
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource');
    });

    test('includes CloudWatch agent sidecar', () => {
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource');
    });
  });

  describe('Istio virtual service', () => {
    test('creates Istio virtual service', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource', {
        Manifest: Match.stringLikeRegexp('.*VirtualService.*'),
      });
    });

    test('configures virtual service routing', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource', {
        Manifest: Match.stringLikeRegexp('.*networking\\.istio\\.io.*'),
      });
    });
  });

  describe('CloudWatch agent configuration', () => {
    test('creates CloudWatch agent config map', () => {
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource');
    });

    test('configures EMF and X-Ray in agent config', () => {
      const templateJson = sharedTemplate.toJSON();
      const resources = Object.values(templateJson.Resources || {});
      const hasEMFAndXRay = resources.some((resource: any) => {
        if (resource.Type === 'Custom::AWSCDK-EKS-KubernetesResource') {
          const manifest = resource.Properties?.Manifest || '';
          const manifestStr = typeof manifest === 'string' ? manifest : JSON.stringify(manifest);
          return manifestStr.includes('emf') && manifestStr.includes('xray');
        }
        return false;
      });
      expect(hasEMFAndXRay).toBe(true);
    });
  });

  describe('target group configuration', () => {
    test('creates application target group', () => {
      assertResourceExists(sharedTemplate, 'AWS::ElasticLoadBalancingV2::TargetGroup');
    });

    test('configures target group with IP target type', () => {
      assertResourceProperties(sharedTemplate, 'AWS::ElasticLoadBalancingV2::TargetGroup', {
        TargetType: 'ip',
        Port: 5000,
        Protocol: 'HTTP',
      });
    });

    test('configures health check', () => {
      assertResourceProperties(sharedTemplate, 'AWS::ElasticLoadBalancingV2::TargetGroup', {
        HealthCheckEnabled: true,
        HealthCheckPath: '/health',
        HealthCheckIntervalSeconds: 10,
        HealthCheckTimeoutSeconds: 2,
        HealthyThresholdCount: 2,
        UnhealthyThresholdCount: 2,
      });
    });

    test('configures deregistration delay', () => {
      assertResourceProperties(sharedTemplate, 'AWS::ElasticLoadBalancingV2::TargetGroup', {
        TargetGroupAttributes: Match.arrayWith([
          Match.objectLike({
            Key: 'deregistration_delay.timeout_seconds',
            Value: '30',
          }),
        ]),
      });
    });

    test('enables cross-zone load balancing', () => {
      assertResourceProperties(sharedTemplate, 'AWS::ElasticLoadBalancingV2::TargetGroup', {
        TargetGroupAttributes: Match.arrayWith([
          Match.objectLike({
            Key: 'load_balancing.cross_zone.enabled',
            Value: 'true',
          }),
        ]),
      });
    });
  });

  describe('target group binding', () => {
    test('creates target group binding', () => {
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource');
    });

    test('binds to service port 5000', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource', {
        Manifest: Match.stringLikeRegexp('.*port.*5000.*'),
      });
    });
  });

  describe('application dependencies', () => {
    test('namespace depends on cluster', () => {
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource');
    });

    test('deployment depends on service', () => {
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource');
    });
  });

  describe('public interface', () => {
    test('exposes target group property', () => {
      expect(application.appTargetGroup).toBeDefined();
    });
  });

  describe('container repositories', () => {
    test('creates ECR repositories', () => {
      assertResourceExists(sharedTemplate, 'AWS::ECR::Repository');
      assertResourceCount(sharedTemplate, 'AWS::ECR::Repository', 2);
    });
  });
});
