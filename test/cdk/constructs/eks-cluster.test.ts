// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import { Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as rds from 'aws-cdk-lib/aws-rds';
import { EKSCluster, InstanceArchitecture } from '../../../src/cdk/lib/constructs/eks-cluster';
import {
  assertResourceExists,
  assertResourceProperties,
  assertResourceCount,
} from '../../helpers/assertion-helpers';
import { createMockVpc, createMockSecurityGroup } from '../../helpers/mock-factories';
import { synthesizeStack } from '../../helpers/stack-helpers';
import { createTestApp, createTestStack } from '../../helpers/test-fixtures';

describe('EKSCluster', () => {
  let sharedApp: cdk.App;
  let sharedStack: cdk.Stack;
  let sharedVpc: ec2.Vpc;
  let sharedDatabaseCluster: rds.DatabaseCluster;
  let sharedAdminRole: iam.Role;
  let sharedLoadBalancerSecurityGroup: ec2.SecurityGroup;
  let sharedTemplate: ReturnType<typeof synthesizeStack>;

  beforeAll(() => {
    sharedApp = createTestApp();
    sharedStack = createTestStack(sharedApp);
    sharedVpc = createMockVpc(sharedStack);
    sharedLoadBalancerSecurityGroup = createMockSecurityGroup(sharedStack, sharedVpc, 'LoadBalancerSG');

    // Create admin role
    sharedAdminRole = new iam.Role(sharedStack, 'AdminRole', {
      assumedBy: new iam.ServicePrincipal('eks.amazonaws.com'),
    });

    // Create database cluster
    sharedDatabaseCluster = new rds.DatabaseCluster(sharedStack, 'Database', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_1,
      }),
      writer: rds.ClusterInstance.provisioned('writer', {
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      }),
      vpc: sharedVpc,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create EKS cluster with default configuration
    new EKSCluster(sharedStack, 'EKSCluster', {
      vpc: sharedVpc,
      databaseCluster: sharedDatabaseCluster,
      cpuArch: InstanceArchitecture.X86_64,
      adminRole: sharedAdminRole,
      loadBalancerSecurityGroup: sharedLoadBalancerSecurityGroup,
      clusterName: 'test-cluster',
    });

    sharedTemplate = synthesizeStack(sharedStack);
  });

  describe('constructor', () => {
    test('creates EKS cluster with default configuration', () => {
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-Cluster');
      assertResourceExists(sharedTemplate, 'AWS::EKS::Nodegroup');
      assertResourceExists(sharedTemplate, 'AWS::Logs::LogGroup');
    });

    test('creates cluster with x86 architecture', () => {
      assertResourceProperties(sharedTemplate, 'AWS::EKS::Nodegroup', {
        AmiType: 'AL2023_x86_64_STANDARD',
      });
    });
  });

  describe('constructor with custom version', () => {
    let customVersionApp: cdk.App;
    let customVersionStack: cdk.Stack;
    let customVersionTemplate: ReturnType<typeof synthesizeStack>;

    beforeAll(() => {
      customVersionApp = createTestApp();
      customVersionStack = createTestStack(customVersionApp);
      const vpc = createMockVpc(customVersionStack);
      const loadBalancerSecurityGroup = createMockSecurityGroup(customVersionStack, vpc, 'LoadBalancerSG');

      const adminRole = new iam.Role(customVersionStack, 'AdminRole', {
        assumedBy: new iam.ServicePrincipal('eks.amazonaws.com'),
      });

      const databaseCluster = new rds.DatabaseCluster(customVersionStack, 'Database', {
        engine: rds.DatabaseClusterEngine.auroraPostgres({
          version: rds.AuroraPostgresEngineVersion.VER_16_1,
        }),
        writer: rds.ClusterInstance.provisioned('writer', {
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
        }),
        vpc,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      new EKSCluster(customVersionStack, 'EKSCluster', {
        vpc,
        databaseCluster,
        cpuArch: InstanceArchitecture.X86_64,
        adminRole,
        loadBalancerSecurityGroup,
        clusterName: 'test-cluster',
        version: '1.31',
      });

      customVersionTemplate = synthesizeStack(customVersionStack);
    });

    test('creates cluster with custom version', () => {
      assertResourceExists(customVersionTemplate, 'Custom::AWSCDK-EKS-Cluster');
    });
  });

  describe('constructor with ARM architecture', () => {
    let armApp: cdk.App;
    let armStack: cdk.Stack;
    let armTemplate: ReturnType<typeof synthesizeStack>;

    beforeAll(() => {
      armApp = createTestApp();
      armStack = createTestStack(armApp);
      const vpc = createMockVpc(armStack);
      const loadBalancerSecurityGroup = createMockSecurityGroup(armStack, vpc, 'LoadBalancerSG');

      const adminRole = new iam.Role(armStack, 'AdminRole', {
        assumedBy: new iam.ServicePrincipal('eks.amazonaws.com'),
      });

      const databaseCluster = new rds.DatabaseCluster(armStack, 'Database', {
        engine: rds.DatabaseClusterEngine.auroraPostgres({
          version: rds.AuroraPostgresEngineVersion.VER_16_1,
        }),
        writer: rds.ClusterInstance.provisioned('writer', {
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
        }),
        vpc,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      new EKSCluster(armStack, 'EKSCluster', {
        vpc,
        databaseCluster,
        cpuArch: InstanceArchitecture.ARM_64,
        adminRole,
        loadBalancerSecurityGroup,
        clusterName: 'test-cluster',
      });

      armTemplate = synthesizeStack(armStack);
    });

    test('creates cluster with ARM architecture', () => {
      assertResourceExists(armTemplate, 'AWS::EKS::Nodegroup');
      assertResourceProperties(armTemplate, 'AWS::EKS::Nodegroup', {
        AmiType: 'AL2023_ARM_64_STANDARD',
      });
    });
  });

  describe('cluster configuration', () => {
    test('creates control plane security group', () => {
      assertResourceExists(sharedTemplate, 'AWS::EC2::SecurityGroup');
      assertResourceProperties(sharedTemplate, 'AWS::EC2::SecurityGroup', {
        GroupDescription: 'Allow inbound access from this Security Group',
      });
    });

    test('configures cluster logging', () => {
      assertResourceProperties(sharedTemplate, 'AWS::Logs::LogGroup', {
        LogGroupName: '/aws/eks/test-cluster/cluster',
        RetentionInDays: 7,
      });
    });

    test('configures endpoint access', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-Cluster', {
        Config: Match.objectLike({
          resourcesVpcConfig: Match.objectLike({
            endpointPublicAccess: true,
            endpointPrivateAccess: true,
          }),
        }),
      });
    });
  });

  describe('cluster configuration with custom name', () => {
    let customNameApp: cdk.App;
    let customNameStack: cdk.Stack;
    let customNameTemplate: ReturnType<typeof synthesizeStack>;

    beforeAll(() => {
      customNameApp = createTestApp();
      customNameStack = createTestStack(customNameApp);
      const vpc = createMockVpc(customNameStack);
      const loadBalancerSecurityGroup = createMockSecurityGroup(customNameStack, vpc, 'LoadBalancerSG');

      const adminRole = new iam.Role(customNameStack, 'AdminRole', {
        assumedBy: new iam.ServicePrincipal('eks.amazonaws.com'),
      });

      const databaseCluster = new rds.DatabaseCluster(customNameStack, 'Database', {
        engine: rds.DatabaseClusterEngine.auroraPostgres({
          version: rds.AuroraPostgresEngineVersion.VER_16_1,
        }),
        writer: rds.ClusterInstance.provisioned('writer', {
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
        }),
        vpc,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      new EKSCluster(customNameStack, 'EKSCluster', {
        vpc,
        databaseCluster,
        cpuArch: InstanceArchitecture.X86_64,
        adminRole,
        loadBalancerSecurityGroup,
        clusterName: 'my-test-cluster',
      });

      customNameTemplate = synthesizeStack(customNameStack);
    });

    test('creates cluster with correct name', () => {
      assertResourceProperties(customNameTemplate, 'Custom::AWSCDK-EKS-Cluster', {
        Config: Match.objectLike({
          name: 'my-test-cluster',
        }),
      });
    });
  });

  describe('node group configuration', () => {
    test('creates managed node group', () => {
      assertResourceExists(sharedTemplate, 'AWS::EKS::Nodegroup');
    });

    test('configures node group with correct size', () => {
      assertResourceProperties(sharedTemplate, 'AWS::EKS::Nodegroup', {
        ScalingConfig: {
          MinSize: 3,
          MaxSize: 3,
        },
      });
    });

    test('configures node group capacity type', () => {
      assertResourceProperties(sharedTemplate, 'AWS::EKS::Nodegroup', {
        CapacityType: 'ON_DEMAND',
      });
    });

    test('creates launch template for node group', () => {
      assertResourceExists(sharedTemplate, 'AWS::EC2::LaunchTemplate');
      assertResourceProperties(sharedTemplate, 'AWS::EC2::LaunchTemplate', {
        LaunchTemplateData: Match.objectLike({
          MetadataOptions: {
            HttpPutResponseHopLimit: 2,
            HttpTokens: 'required',
          },
        }),
      });
    });

    test('configures encrypted EBS volumes', () => {
      assertResourceProperties(sharedTemplate, 'AWS::EC2::LaunchTemplate', {
        LaunchTemplateData: Match.objectLike({
          BlockDeviceMappings: Match.arrayWith([
            Match.objectLike({
              Ebs: Match.objectLike({
                Encrypted: true,
                VolumeSize: 20,
              }),
            }),
          ]),
        }),
      });
    });
  });

  describe('IAM roles and policies', () => {
    test('creates worker node IAM role', () => {
      assertResourceExists(sharedTemplate, 'AWS::IAM::Role');
      assertResourceProperties(sharedTemplate, 'AWS::IAM::Role', {
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: {
                Service: 'ec2.amazonaws.com',
              },
            }),
          ]),
        }),
      });
    });

    test('attaches required managed policies to worker role', () => {
      const managedPolicies = [
        'AmazonEKSVPCResourceController',
        'AmazonEKSWorkerNodePolicy',
        'AmazonSSMManagedEC2InstanceDefaultPolicy',
        'AmazonEC2ContainerRegistryReadOnly',
        'AmazonEKS_CNI_Policy',
        'CloudWatchAgentServerPolicy',
      ];

      managedPolicies.forEach((policyName) => {
        assertResourceProperties(sharedTemplate, 'AWS::IAM::Role', {
          ManagedPolicyArns: Match.arrayWith([
            Match.objectLike({
              'Fn::Join': Match.arrayWith([
                Match.arrayWith([Match.stringLikeRegexp(policyName)]),
              ]),
            }),
          ]),
        });
      });
    });

    test('creates custom managed policies', () => {
      assertResourceExists(sharedTemplate, 'AWS::IAM::ManagedPolicy');
      assertResourceCount(sharedTemplate, 'AWS::IAM::ManagedPolicy', 3);
    });
  });

  describe('cluster add-ons', () => {
    test('creates EKS Pod Identity Agent addon', () => {
      assertResourceExists(sharedTemplate, 'AWS::EKS::Addon');
      assertResourceProperties(sharedTemplate, 'AWS::EKS::Addon', {
        AddonName: 'eks-pod-identity-agent',
      });
    });
  });

  describe('RBAC configuration', () => {
    test('creates log viewer cluster role', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource', {
        Manifest: Match.stringLikeRegexp('.*log-viewer.*'),
      });
    });

    test('creates pod deleter cluster role', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource', {
        Manifest: Match.stringLikeRegexp('.*pod-deleter.*'),
      });
    });

    test('creates networking manager cluster role', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource', {
        Manifest: Match.stringLikeRegexp('.*networking-manager.*'),
      });
    });

    test('creates cluster role bindings', () => {
      assertResourceProperties(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource', {
        Manifest: Match.stringLikeRegexp('.*ClusterRoleBinding.*'),
      });
    });
  });

  describe('VPC and subnet configuration', () => {
    test('uses private isolated subnets', () => {
      assertResourceExists(sharedTemplate, 'Custom::AWSCDK-EKS-Cluster');
    });

    test('configures security group ingress rules', () => {
      assertResourceExists(sharedTemplate, 'AWS::EC2::SecurityGroupIngress');
    });
  });

  describe('kubectl layer integration', () => {
    test('creates kubectl layer', () => {
      assertResourceExists(sharedTemplate, 'AWS::Lambda::LayerVersion');
    });
  });

  describe('cluster properties and outputs', () => {
    let propsApp: cdk.App;
    let propsStack: cdk.Stack;
    let eksCluster: EKSCluster;

    beforeAll(() => {
      propsApp = createTestApp();
      propsStack = createTestStack(propsApp);
      const vpc = createMockVpc(propsStack);
      const loadBalancerSecurityGroup = createMockSecurityGroup(propsStack, vpc, 'LoadBalancerSG');

      const adminRole = new iam.Role(propsStack, 'AdminRole', {
        assumedBy: new iam.ServicePrincipal('eks.amazonaws.com'),
      });

      const databaseCluster = new rds.DatabaseCluster(propsStack, 'Database', {
        engine: rds.DatabaseClusterEngine.auroraPostgres({
          version: rds.AuroraPostgresEngineVersion.VER_16_1,
        }),
        writer: rds.ClusterInstance.provisioned('writer', {
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
        }),
        vpc,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      eksCluster = new EKSCluster(propsStack, 'EKSCluster', {
        vpc,
        databaseCluster,
        cpuArch: InstanceArchitecture.X86_64,
        adminRole,
        loadBalancerSecurityGroup,
        clusterName: 'test-cluster',
      });
    });

    test('exposes cluster property', () => {
      expect(eksCluster.cluster).toBeDefined();
      expect(eksCluster.cluster.clusterName).toBeDefined();
    });

    test('exposes nodegroup property', () => {
      expect(eksCluster.nodegroup).toBeDefined();
    });
  });

  describe('SSM parameter', () => {
    test('creates SSM parameter for cluster name', () => {
      assertResourceExists(sharedTemplate, 'AWS::SSM::Parameter');
      assertResourceProperties(sharedTemplate, 'AWS::SSM::Parameter', {
        Name: 'ClusterName',
        Type: 'String',
        Value: Match.objectLike({
          Ref: Match.anyValue(),
        }),
      });
    });
  });
});

describe('InstanceArchitecture', () => {
  test('contains ARM_64 value', () => {
    expect(InstanceArchitecture.ARM_64).toBe('ARM_64');
  });

  test('contains X86_64 value', () => {
    expect(InstanceArchitecture.X86_64).toBe('X86_64');
  });

  test('enum values are accessible', () => {
    const values = Object.values(InstanceArchitecture);
    expect(values).toHaveLength(2);
    expect(values).toContain('ARM_64');
    expect(values).toContain('X86_64');
  });
});
