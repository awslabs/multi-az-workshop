// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { KubectlV31Layer } from '@aws-cdk/lambda-layer-kubectl-v31';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
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
  readonly databaseCluster: rds.IDatabaseCluster;

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
   * @default "1.32"
   */
  readonly version?: string;
}

/**
 * Construct that creates an EKS cluster with managed node group
 */
export class EKSCluster extends Construct {
  /**
   * The EKS cluster
   */
  public readonly cluster: eks.ICluster;

  /**
   * The managed node group
   */
  public readonly nodegroup: eks.Nodegroup;

  constructor(scope: Construct, id: string, props: EKSClusterProps) {
    super(scope, id);

    const version = props.version ?? '1.32';

    // Create security group for control plane
    const controlPlaneSG = new ec2.SecurityGroup(this, 'EKSClusterControlPlaneSecurityGroup', {
      description: 'Allow inbound access from this Security Group',
      vpc: props.vpc,
    });

    controlPlaneSG.addIngressRule(controlPlaneSG, ec2.Port.allUdp());
    controlPlaneSG.addIngressRule(controlPlaneSG, ec2.Port.allTcp());
    controlPlaneSG.addIngressRule(controlPlaneSG, ec2.Port.allIcmp());

    // Create kubectl layer
    const kubectlLayer = new KubectlV31Layer(this, 'KubectlV31Layer');

    // Create log group for cluster logs
    const clusterLogGroup = new logs.LogGroup(this, 'cluster-log-group', {
      logGroupName: `/aws/eks/${props.clusterName}/cluster`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // Create EKS cluster
    const cluster = new eks.Cluster(this, 'EKSCluster', {
      vpc: props.vpc,
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }],
      defaultCapacity: 0,
      version: eks.KubernetesVersion.of(version),
      placeClusterHandlerInVpc: false,
      endpointAccess: eks.EndpointAccess.PUBLIC_AND_PRIVATE,
      kubectlLayer: kubectlLayer,
      securityGroup: controlPlaneSG,
      mastersRole: props.adminRole,
      clusterName: props.clusterName,
      clusterLogging: [
        eks.ClusterLoggingTypes.CONTROLLER_MANAGER,
        eks.ClusterLoggingTypes.AUTHENTICATOR,
        eks.ClusterLoggingTypes.API,
        eks.ClusterLoggingTypes.AUDIT,
        eks.ClusterLoggingTypes.SCHEDULER,
      ],
    });

    cluster.node.addDependency(clusterLogGroup);

    // Add ingress rules to cluster security group
    cluster.clusterSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(props.loadBalancerSecurityGroup.securityGroupId),
      ec2.Port.tcp(80),
    );
    cluster.clusterSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(props.loadBalancerSecurityGroup.securityGroupId),
      ec2.Port.tcp(5000),
    );
    cluster.clusterSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(cluster.clusterSecurityGroup.securityGroupId),
      ec2.Port.tcp(80),
    );
    cluster.clusterSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(cluster.clusterSecurityGroup.securityGroupId),
      ec2.Port.tcp(5000),
    );

    // Add EKS Pod Identity Agent addon
    new eks.CfnAddon(this, 'PodIdentityAgentAddOn', {
      addonName: 'eks-pod-identity-agent',
      clusterName: cluster.clusterName,
    });

    // Create RBAC roles and bindings
    const logRoleManifest = cluster.addManifest('LogsRole', {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'ClusterRole',
      metadata: {
        name: 'log-viewer',
      },
      rules: [
        {
          apiGroups: [''],
          resources: ['pods', 'pods/log', 'pods/exec'],
          verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
        },
        {
          apiGroups: ['apps'],
          resources: ['deployments'],
          verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
        },
      ],
    });

    const logRoleResource = logRoleManifest.node.findChild('Resource') as cdk.CustomResource;
    (logRoleResource.node.defaultChild as cdk.CfnResource).addPropertyOverride('ServiceTimeout', '300');

    const podDeleterManifest = cluster.addManifest('PodDeleterRole', {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'ClusterRole',
      metadata: {
        name: 'pod-deleter',
      },
      rules: [
        {
          apiGroups: [''],
          resources: ['pods'],
          verbs: ['get', 'list', 'delete'],
        },
      ],
    });

    const podDeleterResource = podDeleterManifest.node.findChild('Resource') as cdk.CustomResource;
    (podDeleterResource.node.defaultChild as cdk.CfnResource).addPropertyOverride('ServiceTimeout', '300');

    const networkingRoleManifest = cluster.addManifest('NetworkingRole', {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'ClusterRole',
      metadata: {
        name: 'networking-manager',
      },
      rules: [
        {
          apiGroups: ['networking.istio.io'],
          resources: ['destinationrules'],
          verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
        },
      ],
    });

    const networkingRoleResource = networkingRoleManifest.node.findChild('Resource') as cdk.CustomResource;
    (networkingRoleResource.node.defaultChild as cdk.CfnResource).addPropertyOverride('ServiceTimeout', '300');

    const logRoleBindingManifest = cluster.addManifest('LogsRoleBinding', {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'ClusterRoleBinding',
      metadata: {
        name: 'log-viewer-global',
        namespace: 'kube-system',
      },
      roleRef: {
        apiGroup: 'rbac.authorization.k8s.io',
        kind: 'ClusterRole',
        name: 'log-viewer',
      },
      subjects: [
        {
          kind: 'Group',
          name: 'system:authenticated',
          apiGroup: 'rbac.authorization.k8s.io',
        },
      ],
    });

    logRoleBindingManifest.node.addDependency(logRoleManifest);
    const logRoleBindingResource = logRoleBindingManifest.node.findChild('Resource') as cdk.CustomResource;
    (logRoleBindingResource.node.defaultChild as cdk.CfnResource).addPropertyOverride('ServiceTimeout', '300');

    const networkingRoleBindingManifest = cluster.addManifest('NetworkingRoleBinding', {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'ClusterRoleBinding',
      metadata: {
        name: 'networking-manager-global',
        namespace: 'multi-az-workshop',
      },
      roleRef: {
        apiGroup: 'rbac.authorization.k8s.io',
        kind: 'ClusterRole',
        name: 'networking-manager',
      },
      subjects: [
        {
          kind: 'Group',
          name: 'system:authenticated',
          apiGroup: 'rbac.authorization.k8s.io',
        },
      ],
    });

    networkingRoleBindingManifest.node.addDependency(networkingRoleManifest);
    const networkingRoleBindingResource = networkingRoleBindingManifest.node.findChild('Resource') as cdk.CustomResource;
    (networkingRoleBindingResource.node.defaultChild as cdk.CfnResource).addPropertyOverride('ServiceTimeout', '300');

    const podDeleterRoleBindingManifest = cluster.addManifest('PodDeleterRoleBinding', {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'ClusterRoleBinding',
      metadata: {
        name: 'pod-deleter-global',
        namespace: 'multi-az-workshop',
      },
      roleRef: {
        apiGroup: 'rbac.authorization.k8s.io',
        kind: 'ClusterRole',
        name: 'pod-deleter',
      },
      subjects: [
        {
          kind: 'Group',
          name: 'system:authenticated',
          apiGroup: 'rbac.authorization.k8s.io',
        },
      ],
    });

    podDeleterRoleBindingManifest.node.addDependency(podDeleterManifest);
    const podDeleterRoleBindingResource = podDeleterRoleBindingManifest.node.findChild('Resource') as cdk.CustomResource;
    (podDeleterRoleBindingResource.node.defaultChild as cdk.CfnResource).addPropertyOverride('ServiceTimeout', '300');

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

    // Add role mapping for worker nodes
    cluster.awsAuth.addRoleMapping(eksWorkerRole, {
      groups: ['system:masters', 'system:bootstrappers', 'system:nodes', 'log-viewer-global', 'pod-deleter'],
      username: 'system:node:{{EC2PrivateDNSName}}',
    });

    // Create SSM parameter for cluster name
    new ssm.StringParameter(this, 'ClusterParameter', {
      parameterName: 'ClusterName',
      stringValue: cluster.clusterName,
    });

    // Create launch template for node group
    const lt = new ec2.LaunchTemplate(this, 'NodeGroupLaunchTemplate', {
      httpPutResponseHopLimit: 2,
      httpTokens: ec2.LaunchTemplateHttpTokens.REQUIRED,
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
    this.nodegroup = cluster.addNodegroupCapacity('ManagedNodeGroup', {
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

    this.cluster = cluster;
  }
}
