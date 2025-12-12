// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as rds from 'aws-cdk-lib/aws-rds';
import { AwsLoadBalancerController } from '../constructs/aws-load-balancer-controller';
import { ContainerAndRepo } from '../constructs/container-and-repo';
import { EKSApplication } from '../constructs/eks-application';
import { EKSCluster, InstanceArchitecture } from '../constructs/eks-cluster';
import { Istio } from '../constructs/istio';
import { NestedStackWithSource } from '../constructs/nested-stack-with-source';

/**
 * Props for EKS Stack
 */
export interface EKSStackProps extends cdk.NestedStackProps {
  /**
   * VPC where the EKS cluster will be deployed
   */
  readonly vpc: ec2.IVpc;

  /**
   * CPU architecture for nodes
   * @default ARM_64
   */
  readonly cpuArch?: InstanceArchitecture;

  /**
   * Database cluster
   */
  readonly database: rds.DatabaseCluster;

  /**
   * Load balancer security group
   */
  readonly loadBalancerSecurityGroup: ec2.ISecurityGroup;

  /**
   * IAM resource path
   * @default "/front-end/eks-fleet/"
   */
  readonly iamResourcePath?: string;

  /**
   * Admin role name for EKS cluster access
   */
  readonly adminRoleName: string;

  /**
   * Shared ECR uploader Lambda function
   */
  readonly uploaderFunction: lambda.IFunction;
}

/**
 * Nested stack that creates an EKS cluster with Istio and application
 */
export class EKSStack extends NestedStackWithSource {
  /**
   * Target group for the EKS application
   */
  public readonly eksAppTargetGroup: elbv2.IApplicationTargetGroup;

  constructor(scope: cdk.Stack, id: string, props: EKSStackProps) {
    super(scope, id, props);

    const cpuArch = props.cpuArch ?? InstanceArchitecture.ARM_64;

    // Read versions from build configuration
    // When running with ts-node, __dirname is src/cdk/lib/nested-stacks, so we need to go up 4 levels
    const versionsPath = path.join(__dirname, '..', '..', '..', '..', 'build', 'versions.json');
    const versions = JSON.parse(fs.readFileSync(versionsPath, 'utf-8'));

    // Create container and repository builder
    const repoHelmContainerCreator = new ContainerAndRepo(this, 'container-and-repo-builder', {
      uploaderFunction: props.uploaderFunction,
    });

    // Create EKS cluster
    const adminRole = iam.Role.fromRoleName(this, 'AdminRole', props.adminRoleName);

    const cluster = new EKSCluster(this, 'Cluster', {
      adminRole,
      cpuArch,
      databaseCluster: props.database,
      vpc: props.vpc,
      loadBalancerSecurityGroup: props.loadBalancerSecurityGroup,
      clusterName: 'multi-az-workshop-eks-cluster',
      version: versions.EKS,
    });

    // Fix up nested stacks for kubectl and cluster resource providers
    this.fixUpNestedStacks();

    // Install Istio service mesh
    const istio = new Istio(this, 'Istio', {
      cluster: cluster.cluster,
      containerAndRepoBuilder: repoHelmContainerCreator,
      version: versions.ISTIO,
    });

    // Install AWS Load Balancer Controller
    const lbController = new AwsLoadBalancerController(this, 'AwsLoadBalancerController', {
      cluster: cluster.cluster,
      containerAndRepoBuilder: repoHelmContainerCreator,
      containerVersion: versions.LB_CONTROLLER_CONTAINER,
      helmVersion: versions.LB_CONTROLLER_HELM,
    });
    lbController.node.addDependency(istio.waitableNode);

    // Deploy application
    const app = new EKSApplication(this, 'EKSApp', {
      cluster: cluster.cluster,
      containerAndRepoBuilder: repoHelmContainerCreator,
      databaseCluster: props.database,
      namespace: 'multi-az-workshop',
    });
    app.node.addDependency(istio);
    app.node.addDependency(lbController.waitableNode);

    this.eksAppTargetGroup = app.appTargetGroup;
  }

  /**
   * Fix up nested stacks created by CDK for EKS cluster and kubectl provider
   * Adds AssetsBucketName and AssetsBucketPrefix parameters and sets regional STS endpoints
   */
  private fixUpNestedStacks(): void {
    this.fixUpResourceProvider('@aws-cdk--aws-eks.ClusterResourceProvider');
    this.fixUpResourceProvider('@aws-cdk--aws-eks.KubectlProvider');
    this.fixUpLambdaFunctions('@aws-cdk--aws-eks.KubectlProvider');
  }

  /**
   * Fix up Lambda functions in nested stacks to use regional STS endpoints
   */
  private fixUpLambdaFunctions(name: string): void {
    const resourceProviderNestedStack = this.node.tryFindChild(name);

    if (resourceProviderNestedStack) {
      const nestedStack = resourceProviderNestedStack as cdk.NestedStack;

      if (nestedStack) {
        const lambda = nestedStack.node.tryFindChild('Handler');
        if (lambda) {
          (lambda as any).addEnvironment('AWS_STS_REGIONAL_ENDPOINTS', 'regional');
        }

        const provider = nestedStack.node.tryFindChild('Provider');
        if (provider) {
          const onEvent = provider.node.tryFindChild('framework-onEvent');
          if (onEvent) {
            (onEvent as any).addEnvironment('AWS_STS_REGIONAL_ENDPOINTS', 'regional');
          }
        }
      }
    }
  }

  /**
   * Fix up resource provider nested stacks to include AssetsBucketName and AssetsBucketPrefix parameters
   */
  private fixUpResourceProvider(name: string): void {
    const resourceProviderNestedStack = this.node.tryFindChild(name);

    if (resourceProviderNestedStack) {
      const nestedStack = resourceProviderNestedStack as cdk.NestedStack;

      if (nestedStack) {
        // Add parameters to the nested stack
        new cdk.CfnParameter(nestedStack, 'AssetsBucketName', {
          type: 'String',
        });

        new cdk.CfnParameter(nestedStack, 'AssetsBucketPrefix', {
          type: 'String',
        });
      }
    }
  }
}
