// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { KubectlV35Layer } from '@aws-cdk/lambda-layer-kubectl-v35';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from '@aws-cdk/aws-eks-v2-alpha';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

/**
 * Instance architecture for EKS nodes
 */
export enum InstanceArchitecture {
  ARM_64 = 'ARM_64',
  X86_64 = 'X86_64',
}

/**
 * Properties for EKS Cluster construct
 */
export interface EKSClusterProps {
  /**
   * VPC to deploy the cluster in
   */
  readonly vpc: ec2.IVpc;

  /**
   * Database cluster for the application
   */
  //readonly databaseCluster: rds.IDatabaseCluster;

  /**
   * CPU architecture for the worker nodes
   */
  readonly cpuArch: InstanceArchitecture;

  /**
   * IAM role for cluster administration
   */
  readonly adminRole: iam.IRole;

  /**
   * Security group for the load balancer
   */
  readonly loadBalancerSecurityGroup: ec2.ISecurityGroup;

  /**
   * Name of the EKS cluster
   */
  readonly clusterName: string;

  /**
   * Kubernetes version
   */
  readonly version: eks.KubernetesVersion;
}

/**
 * Construct that creates an EKS cluster with managed node group
 */
export class EKSClusterV2 extends Construct {
  /**
   * The EKS cluster
   */
  public readonly cluster: eks.ICluster;

  constructor(scope: Construct, id: string, props: EKSClusterProps) {
    super(scope, id);

    //Worker node security group
    const workerSecurityGroup: ec2.ISecurityGroup = new ec2.SecurityGroup(this, "WorkerNodeSecurityGroup", {
        description: "Allows inbound access from the load balancer",
        vpc: props.vpc
    });

    workerSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(props.loadBalancerSecurityGroup.securityGroupId),
      ec2.Port.tcp(5000)
    );

    // Create IAM role for EKS worker nodes
    const eksWorkerRole = new iam.Role(this, 'EKSWorkerRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });

    eksWorkerRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSVPCResourceController'));
    eksWorkerRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSWorkerNodePolicy'));
    eksWorkerRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedEC2InstanceDefaultPolicy'));
    eksWorkerRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'));
    eksWorkerRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKS_CNI_Policy'));
    eksWorkerRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'));
    eksWorkerRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AWSSecretsManagerClientReadOnlyAccess'));

    // Allow support for IPv6 if needed
    eksWorkerRole.addManagedPolicy(
      new iam.ManagedPolicy(this, 'EKSWorkerCNIIPv6ManagedPolicy', {
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['ec2:AssignIpv6Addresses'],
            resources: ['*'],
          }),
        ],
      }),
    );

    // Allow the worker nodes to pull down the istio destination rules file from S3
    eksWorkerRole.addManagedPolicy(
      new iam.ManagedPolicy(this, 'EKSWorkerS3ManagedPolicy', {
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['s3:GetObject', 's3:ListBucket'],
            resources: ['*'],
          }),
        ],
      }),
    );

    // Get parameters used in the workshop, i.e. cluster name and s3 bucket
    eksWorkerRole.addManagedPolicy(
      new iam.ManagedPolicy(this, 'EKSWorkerSSMManagedPolicy', {
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['ssm:GetParameter'],
            resources: ['*'],
          }),
        ],
      }),
    );

    // Create log group for cluster logs
    const clusterLogGroup = new logs.LogGroup(this, 'cluster-log-group', {
      logGroupName: `/aws/eks/${props.clusterName}/cluster`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    const cluster = new eks.Cluster(this, 'EKSCluster', {
        vpc: props.vpc,
        vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }],
        endpointAccess: eks.EndpointAccess.PRIVATE,
        version: props.version,
        defaultCapacity: 0,
        defaultCapacityType: eks.DefaultCapacityType.NODEGROUP,

        kubectlProviderOptions: {
            kubectlLayer: new KubectlV35Layer(this, "KubectlLayer"),
            privateSubnets: props.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnets,
        },

        clusterLogging: [
          eks.ClusterLoggingTypes.CONTROLLER_MANAGER,
          eks.ClusterLoggingTypes.AUTHENTICATOR,
          eks.ClusterLoggingTypes.API,
          eks.ClusterLoggingTypes.AUDIT,
          eks.ClusterLoggingTypes.SCHEDULER,
        ],
    });

    cluster.node.addDependency(clusterLogGroup);

    // Create SSM parameter for cluster name
    new ssm.StringParameter(this, 'ClusterParameter', {
      parameterName: 'TestClusterName',
      stringValue: cluster.clusterName,
    });

    // Create launch template for node group so that we can specify
    // IMDSv2 settings directly and specify disk encryption
    const lt = new ec2.LaunchTemplate(this, 'NodeGroupLaunchTemplate', {
      httpPutResponseHopLimit: 2,
      httpTokens: ec2.LaunchTemplateHttpTokens.REQUIRED,
      securityGroup: workerSecurityGroup,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(20, {
            encrypted: true,
          }),
        },
      ],
    });

    // When the security group is specified in the launch template,
    // EKS doesn't automatically add the cluster security group to
    // the instance
    lt.addSecurityGroup(cluster.clusterSecurityGroup);

    // Create managed node group
    cluster.addNodegroupCapacity('ManagedNodeGroup', {
      amiType:
        props.cpuArch === InstanceArchitecture.ARM_64
          ? eks.NodegroupAmiType.AL2023_ARM_64_STANDARD
          : eks.NodegroupAmiType.AL2023_X86_64_STANDARD,
      capacityType: eks.CapacityType.ON_DEMAND,
      enableNodeAutoRepair: true,   
      minSize: 3,
      maxSize: 3,
      instanceTypes: [
        ec2.InstanceType.of(
          props.cpuArch === InstanceArchitecture.ARM_64 ? ec2.InstanceClass.T4G : ec2.InstanceClass.T3,
          ec2.InstanceSize.LARGE,
        ),
      ],
      nodeRole: eksWorkerRole,
      launchTemplateSpec: {
        id: lt.launchTemplateId!,
        version: lt.latestVersionNumber,
      },
    });

    // Add EKS Pod Identity Agent addon
    new eks.Addon(this, 'PodIdentityAgentAddOn', {
      cluster,
      addonName: 'eks-pod-identity-agent',
    });

    cluster.grantAccess(
      "ParticipantRoleReadOnlyAccess", 
      props.adminRole.roleArn, 
      [
        eks.AccessPolicy.fromAccessPolicyName('AmazonEKSViewPolicy', {
          accessScopeType: eks.AccessScopeType.CLUSTER
        }),
      ], 
      { 
        accessEntryType: eks.AccessEntryType.STANDARD 
      }
    );

    this.cluster = cluster;
  }

  /**
   * Creates the IAM policy for the AWS Load Balancer Controller by fetching
   * the policy document from the GitHub repository
   */
  private createAwsLoadBalancerControllerIAMPolicy(): iam.ManagedPolicy {
    // Note: In the C# version, this fetches the policy from GitHub at synthesis time.
    // In TypeScript, we'll use a custom resource to fetch it, but for now we'll
    // create a placeholder that should be replaced with the actual policy.
    // The policy URL is: https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/${_version}/docs/install/iam_policy.json

    // For CDK synthesis to work, we need to provide the policy inline
    // This is the standard AWS Load Balancer Controller policy
    const policyDocument = iam.PolicyDocument.fromJson({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['iam:CreateServiceLinkedRole'],
          Resource: '*',
          Condition: {
            StringEquals: {
              'iam:AWSServiceName': 'elasticloadbalancing.amazonaws.com',
            },
          },
        },
        {
          Effect: 'Allow',
          Action: [
            'ec2:DescribeAccountAttributes',
            'ec2:DescribeAddresses',
            'ec2:DescribeAvailabilityZones',
            'ec2:DescribeInternetGateways',
            'ec2:DescribeVpcs',
            'ec2:DescribeVpcPeeringConnections',
            'ec2:DescribeSubnets',
            'ec2:DescribeSecurityGroups',
            'ec2:DescribeInstances',
            'ec2:DescribeNetworkInterfaces',
            'ec2:DescribeTags',
            'ec2:GetCoipPoolUsage',
            'ec2:DescribeCoipPools',
            'elasticloadbalancing:DescribeLoadBalancers',
            'elasticloadbalancing:DescribeLoadBalancerAttributes',
            'elasticloadbalancing:DescribeListeners',
            'elasticloadbalancing:DescribeListenerCertificates',
            'elasticloadbalancing:DescribeSSLPolicies',
            'elasticloadbalancing:DescribeRules',
            'elasticloadbalancing:DescribeTargetGroups',
            'elasticloadbalancing:DescribeTargetGroupAttributes',
            'elasticloadbalancing:DescribeTargetHealth',
            'elasticloadbalancing:DescribeTags',
            'elasticloadbalancing:DescribeTrustStores',
          ],
          Resource: '*',
        },
        {
          Effect: 'Allow',
          Action: [
            'cognito-idp:DescribeUserPoolClient',
            'acm:ListCertificates',
            'acm:DescribeCertificate',
            'iam:ListServerCertificates',
            'iam:GetServerCertificate',
            'waf-regional:GetWebACL',
            'waf-regional:GetWebACLForResource',
            'waf-regional:AssociateWebACL',
            'waf-regional:DisassociateWebACL',
            'wafv2:GetWebACL',
            'wafv2:GetWebACLForResource',
            'wafv2:AssociateWebACL',
            'wafv2:DisassociateWebACL',
            'shield:GetSubscriptionState',
            'shield:DescribeProtection',
            'shield:CreateProtection',
            'shield:DeleteProtection',
          ],
          Resource: '*',
        },
        {
          Effect: 'Allow',
          Action: [
            'ec2:AuthorizeSecurityGroupIngress',
            'ec2:RevokeSecurityGroupIngress',
          ],
          Resource: '*',
        },
        {
          Effect: 'Allow',
          Action: ['ec2:CreateSecurityGroup'],
          Resource: '*',
        },
        {
          Effect: 'Allow',
          Action: ['ec2:CreateTags'],
          Resource: 'arn:aws:ec2:*:*:security-group/*',
          Condition: {
            StringEquals: {
              'ec2:CreateAction': 'CreateSecurityGroup',
            },
            Null: {
              'aws:RequestTag/elbv2.k8s.aws/cluster': 'false',
            },
          },
        },
        {
          Effect: 'Allow',
          Action: ['ec2:CreateTags', 'ec2:DeleteTags'],
          Resource: 'arn:aws:ec2:*:*:security-group/*',
          Condition: {
            Null: {
              'aws:RequestTag/elbv2.k8s.aws/cluster': 'true',
              'aws:ResourceTag/elbv2.k8s.aws/cluster': 'false',
            },
          },
        },
        {
          Effect: 'Allow',
          Action: ['ec2:AuthorizeSecurityGroupIngress', 'ec2:RevokeSecurityGroupIngress', 'ec2:DeleteSecurityGroup'],
          Resource: '*',
          Condition: {
            Null: {
              'aws:ResourceTag/elbv2.k8s.aws/cluster': 'false',
            },
          },
        },
        {
          Effect: 'Allow',
          Action: [
            'elasticloadbalancing:CreateLoadBalancer',
            'elasticloadbalancing:CreateTargetGroup',
          ],
          Resource: '*',
          Condition: {
            Null: {
              'aws:RequestTag/elbv2.k8s.aws/cluster': 'false',
            },
          },
        },
        {
          Effect: 'Allow',
          Action: [
            'elasticloadbalancing:CreateListener',
            'elasticloadbalancing:DeleteListener',
            'elasticloadbalancing:CreateRule',
            'elasticloadbalancing:DeleteRule',
          ],
          Resource: '*',
        },
        {
          Effect: 'Allow',
          Action: [
            'elasticloadbalancing:AddListenerCertificates',
            'elasticloadbalancing:RemoveListenerCertificates',
            'elasticloadbalancing:ModifyListener',
          ],
          Resource: '*',
        },
        {
          Effect: 'Allow',
          Action: ['elasticloadbalancing:AddTags', 'elasticloadbalancing:RemoveTags'],
          Resource: [
            'arn:aws:elasticloadbalancing:*:*:targetgroup/*/*',
            'arn:aws:elasticloadbalancing:*:*:loadbalancer/net/*/*',
            'arn:aws:elasticloadbalancing:*:*:loadbalancer/app/*/*',
          ],
          Condition: {
            Null: {
              'aws:RequestTag/elbv2.k8s.aws/cluster': 'true',
              'aws:ResourceTag/elbv2.k8s.aws/cluster': 'false',
            },
          },
        },
        {
          Effect: 'Allow',
          Action: ['elasticloadbalancing:AddTags', 'elasticloadbalancing:RemoveTags'],
          Resource: [
            'arn:aws:elasticloadbalancing:*:*:listener/net/*/*/*',
            'arn:aws:elasticloadbalancing:*:*:listener/app/*/*/*',
            'arn:aws:elasticloadbalancing:*:*:listener-rule/net/*/*/*',
            'arn:aws:elasticloadbalancing:*:*:listener-rule/app/*/*/*',
          ],
        },
        {
          Effect: 'Allow',
          Action: [
            'elasticloadbalancing:ModifyLoadBalancerAttributes',
            'elasticloadbalancing:SetIpAddressType',
            'elasticloadbalancing:SetSecurityGroups',
            'elasticloadbalancing:SetSubnets',
            'elasticloadbalancing:DeleteLoadBalancer',
            'elasticloadbalancing:ModifyTargetGroup',
            'elasticloadbalancing:ModifyTargetGroupAttributes',
            'elasticloadbalancing:DeleteTargetGroup',
          ],
          Resource: '*',
          Condition: {
            Null: {
              'aws:ResourceTag/elbv2.k8s.aws/cluster': 'false',
            },
          },
        },
        {
          Effect: 'Allow',
          Action: ['elasticloadbalancing:AddTags'],
          Resource: [
            'arn:aws:elasticloadbalancing:*:*:targetgroup/*/*',
            'arn:aws:elasticloadbalancing:*:*:loadbalancer/net/*/*',
            'arn:aws:elasticloadbalancing:*:*:loadbalancer/app/*/*',
          ],
          Condition: {
            StringEquals: {
              'elasticloadbalancing:CreateAction': ['CreateTargetGroup', 'CreateLoadBalancer'],
            },
            Null: {
              'aws:RequestTag/elbv2.k8s.aws/cluster': 'false',
            },
          },
        },
        {
          Effect: 'Allow',
          Action: [
            'elasticloadbalancing:RegisterTargets',
            'elasticloadbalancing:DeregisterTargets',
          ],
          Resource: 'arn:aws:elasticloadbalancing:*:*:targetgroup/*/*',
        },
        {
          Effect: 'Allow',
          Action: [
            'elasticloadbalancing:SetWebAcl',
            'elasticloadbalancing:ModifyListener',
            'elasticloadbalancing:AddListenerCertificates',
            'elasticloadbalancing:RemoveListenerCertificates',
            'elasticloadbalancing:ModifyRule',
          ],
          Resource: '*',
        },
      ],
    });

    return new iam.ManagedPolicy(this, 'AwsLoadBalancerControllerManagedPolicy', {
      document: policyDocument,
    });
  }
}