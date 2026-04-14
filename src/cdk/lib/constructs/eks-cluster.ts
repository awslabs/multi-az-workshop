// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { KubectlV35Layer as KubectlLayer } from '@aws-cdk/lambda-layer-kubectl-v35';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from 'aws-cdk-lib/aws-eks-v2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { worker } from 'node:cluster';

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
export class EKSCluster extends Construct {
  /**
   * The EKS cluster
   */
  public readonly cluster: eks.ICluster;

  constructor(scope: Construct, id: string, props: EKSClusterProps) {
    super(scope, id);

    // Worker node security group
    const workerSecurityGroup: ec2.ISecurityGroup = new ec2.SecurityGroup(this, "WorkerNodeSecurityGroup", {
        description: "Allows inbound access from the load balancer",
        vpc: props.vpc
    });

    workerSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(props.loadBalancerSecurityGroup.securityGroupId),
      ec2.Port.tcp(5000)
    );

    // "Additional" security group for cluster
    const controlPlaneSecondarySecurityGroup: ec2.ISecurityGroup = new ec2.SecurityGroup(this, "SecondaryControlPlaneSecurityGroup", {
      description: "Security group assigned to EKS control plane ENIs. Trusts worker node security group for control plane communication.",
      vpc: props.vpc
    });

    controlPlaneSecondarySecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(workerSecurityGroup.securityGroupId),
      ec2.Port.HTTPS
    );

    // Create IAM role for EKS worker nodes
    const eksWorkerRole = new iam.Role(this, 'EKSWorkerRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });

    const userKubectlRole: iam.IRole = new iam.Role(this, "UserKubectlRole", {
      assumedBy: eksWorkerRole
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

    // Allow user to assume the kubectl role
    eksWorkerRole.addManagedPolicy(
      new iam.ManagedPolicy(this, "AssumeRoleManagedPolicy", {
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['sts:AssumeRole'],
            resources: [
              userKubectlRole.roleArn
            ],
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
        clusterName: props.clusterName,

        kubectlProviderOptions: {
            kubectlLayer: new KubectlLayer(this, "KubectlLayer"),
            privateSubnets: props.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnets,
        },

        // This defines the first "additional" security group for the cluster
        // It is not added to the launch template by default. It is not the security
        // group that is referenced by cluster.clusterSecurityGroup. It is assigned 
        // to the EKS control plane ENIs. Use this SG to just trust the security
        // group used in the launch template. This prevents adding ingress rules to
        // the cluster kubectl lambda security groups that aren't needed.
        securityGroup: controlPlaneSecondarySecurityGroup,

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
      parameterName: 'ClusterName',
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
        eks.AccessPolicy.fromAccessPolicyName('AmazonEKSAdminViewPolicy', {
          accessScopeType: eks.AccessScopeType.CLUSTER
        }),
      ], 
      { 
        accessEntryType: eks.AccessEntryType.STANDARD 
      }
    );

    cluster.grantAccess(
      "UserKubetclRoleAccessEntry",
      userKubectlRole.roleArn,
      [
        eks.AccessPolicy.fromAccessPolicyName('AmazonEKSEditPolicy', {
          accessScopeType: eks.AccessScopeType.CLUSTER
        }),
      ],
      {
        accessEntryType: eks.AccessEntryType.STANDARD
      }
    );

    this.cluster = cluster;
  }
}