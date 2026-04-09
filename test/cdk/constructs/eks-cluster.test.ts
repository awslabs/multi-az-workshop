// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import { Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as iam from 'aws-cdk-lib/aws-iam';
import { EKSCluster, InstanceArchitecture } from '../../../src/cdk/lib/constructs/eks-cluster';
import {
  assertResourceExists,
  assertResourceProperties,
} from '../../helpers/assertion-helpers';
import { createMockVpc, createMockSecurityGroup } from '../../helpers/mock-factories';
import { synthesizeStack } from '../../helpers/stack-helpers';
import { createTestApp, createTestStack } from '../../helpers/test-fixtures';

describe('EKSCluster', () => {
  let sharedApp: cdk.App;
  let sharedStack: cdk.Stack;
  let sharedVpc: ec2.Vpc;
  let sharedAdminRole: iam.Role;
  let sharedLoadBalancerSecurityGroup: ec2.SecurityGroup;
  let sharedTemplate: ReturnType<typeof synthesizeStack>;

  beforeAll(() => {
    sharedApp = createTestApp();
    sharedStack = createTestStack(sharedApp);
    sharedVpc = createMockVpc(sharedStack);
    sharedLoadBalancerSecurityGroup = createMockSecurityGroup(sharedStack, sharedVpc, 'LoadBalancerSG');

    sharedAdminRole = new iam.Role(sharedStack, 'AdminRole', {
      assumedBy: new iam.ServicePrincipal('eks.amazonaws.com'),
    });

    new EKSCluster(sharedStack, 'EKSCluster', {
      vpc: sharedVpc,
      cpuArch: InstanceArchitecture.X86_64,
      adminRole: sharedAdminRole,
      loadBalancerSecurityGroup: sharedLoadBalancerSecurityGroup,
      clusterName: 'test-cluster',
      version: eks.KubernetesVersion.of('1.35'),
    });

    sharedTemplate = synthesizeStack(sharedStack);
  });

  describe('constructor', () => {
    test('creates EKS cluster with default configuration', () => {
      assertResourceExists(sharedTemplate, 'AWS::EKS::Cluster');
      assertResourceExists(sharedTemplate, 'AWS::EKS::Nodegroup');
      assertResourceExists(sharedTemplate, 'AWS::Logs::LogGroup');
    });

    test('creates cluster with x86 architecture', () => {
      assertResourceProperties(sharedTemplate, 'AWS::EKS::Nodegroup', {
        AmiType: 'AL2023_x86_64_STANDARD',
      });
    });
  });

  describe('constructor with ARM architecture', () => {
    let armTemplate: ReturnType<typeof synthesizeStack>;

    beforeAll(() => {
      const armApp = createTestApp();
      const armStack = createTestStack(armApp);
      const vpc = createMockVpc(armStack);
      const lbSg = createMockSecurityGroup(armStack, vpc, 'LoadBalancerSG');
      const adminRole = new iam.Role(armStack, 'AdminRole', {
        assumedBy: new iam.ServicePrincipal('eks.amazonaws.com'),
      });

      new EKSCluster(armStack, 'EKSCluster', {
        vpc,
        cpuArch: InstanceArchitecture.ARM_64,
        adminRole,
        loadBalancerSecurityGroup: lbSg,
        clusterName: 'test-cluster',
        version: eks.KubernetesVersion.of('1.35'),
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
    test('configures cluster logging', () => {
      assertResourceProperties(sharedTemplate, 'AWS::Logs::LogGroup', {
        LogGroupName: '/aws/eks/test-cluster/cluster',
        RetentionInDays: 7,
      });
    });

    test('configures cluster with correct name', () => {
      assertResourceProperties(sharedTemplate, 'AWS::EKS::Cluster', {
        Name: 'test-cluster',
      });
    });

    test('configures private endpoint access', () => {
      assertResourceProperties(sharedTemplate, 'AWS::EKS::Cluster', {
        ResourcesVpcConfig: Match.objectLike({
          EndpointPublicAccess: false,
          EndpointPrivateAccess: true,
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

  describe('access entries', () => {
    test('creates access entry for admin role', () => {
      assertResourceExists(sharedTemplate, 'AWS::EKS::AccessEntry');
    });
  });

  describe('VPC and subnet configuration', () => {
    test('creates EKS cluster', () => {
      assertResourceExists(sharedTemplate, 'AWS::EKS::Cluster');
    });

    test('creates worker node security group', () => {
      assertResourceExists(sharedTemplate, 'AWS::EC2::SecurityGroup');
    });
  });

  describe('cluster properties and outputs', () => {
    let eksCluster: EKSCluster;

    beforeAll(() => {
      const propsApp = createTestApp();
      const propsStack = createTestStack(propsApp);
      const vpc = createMockVpc(propsStack);
      const lbSg = createMockSecurityGroup(propsStack, vpc, 'LoadBalancerSG');
      const adminRole = new iam.Role(propsStack, 'AdminRole', {
        assumedBy: new iam.ServicePrincipal('eks.amazonaws.com'),
      });

      eksCluster = new EKSCluster(propsStack, 'EKSCluster', {
        vpc,
        cpuArch: InstanceArchitecture.X86_64,
        adminRole,
        loadBalancerSecurityGroup: lbSg,
        clusterName: 'test-cluster',
        version: eks.KubernetesVersion.of('1.35'),
      });
    });

    test('exposes cluster property', () => {
      expect(eksCluster.cluster).toBeDefined();
      expect(eksCluster.cluster.clusterName).toBeDefined();
    });
  });

  describe('SSM parameter', () => {
    test('creates SSM parameter for cluster name', () => {
      assertResourceExists(sharedTemplate, 'AWS::SSM::Parameter');
      assertResourceProperties(sharedTemplate, 'AWS::SSM::Parameter', {
        Name: 'ClusterName',
        Type: 'String',
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
