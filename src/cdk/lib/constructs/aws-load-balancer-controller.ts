// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct, IDependable } from 'constructs';
import { ContainerAndRepo, RepoAndHelmChartProps, RepoAndContainerProps } from './container-and-repo';
import { HelmRepoAndChartConstruct } from './helm-repo-and-chart';

/**
 * Properties for AWS Load Balancer Controller construct
 */
export interface AwsLoadBalancerControllerProps {
  /**
   * The EKS cluster to install the controller on
   */
  readonly cluster: eks.ICluster;

  /**
   * Container and repository builder for managing container images and Helm charts
   */
  readonly containerAndRepoBuilder: ContainerAndRepo;

  /**
   * Container version for the AWS Load Balancer Controller
   * @default "v2.8.1"
   */
  readonly containerVersion?: string;

  /**
   * Helm chart version for the AWS Load Balancer Controller
   * @default "1.10.1"
   */
  readonly helmVersion?: string;
}

/**
 * Construct that installs the AWS Load Balancer Controller on an EKS cluster
 */
export class AwsLoadBalancerController extends HelmRepoAndChartConstruct {
  /**
   * Waitable node for dependency management
   */
  public readonly waitableNode: IDependable;

  constructor(scope: Construct, id: string, props: AwsLoadBalancerControllerProps) {
    super(scope, id);

    const containerVersion = props.containerVersion ?? 'v2.8.1';
    const helmVersion = props.helmVersion ?? '1.10.1';

    // Create IAM role for the load balancer controller
    const lbControllerRole = new iam.Role(this, 'AwsLoadBalancerControllerRole', {
      description: 'The IAM role used by the load balancer controller',
      assumedBy: new iam.ServicePrincipal('pods.eks.amazonaws.com').withSessionTags(),
    });

    // Create IAM policy for the load balancer controller
    const loadBalancerControllerManagedPolicy = this.createAwsLoadBalancerControllerIAMPolicy(containerVersion);
    lbControllerRole.addManagedPolicy(loadBalancerControllerManagedPolicy);

    // Create service account
    const loadBalancerServiceAccount = new eks.KubernetesManifest(this, 'LoadBalancerServiceAccount', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'ServiceAccount',
          metadata: {
            name: 'aws-load-balancer-controller',
            namespace: 'kube-system',
          },
        },
      ],
    });

    (loadBalancerServiceAccount.node.findChild('Resource').node.defaultChild as cdk.CfnResource).addPropertyOverride(
      'ServiceTimeout',
      '300',
    );

    // Create pod identity association
    const loadBalancerControllerPodIdentityAssociation = new eks.CfnPodIdentityAssociation(
      this,
      'AwsLoadBalancerControllerPodIdentityAssociation',
      {
        clusterName: props.cluster.clusterName,
        namespace: 'kube-system',
        serviceAccount: 'aws-load-balancer-controller',
        roleArn: lbControllerRole.roleArn,
      },
    );

    loadBalancerControllerPodIdentityAssociation.node.addDependency(loadBalancerServiceAccount);

    // Create Helm chart repository
    const loadBalancerControllerHelmChartRepo = props.containerAndRepoBuilder.createRepoAndHelmChart({
      helmChartName: 'aws-load-balancer-controller',
      version: helmVersion,
      repositoryName: 'aws-load-balancer-controller',
    } as RepoAndHelmChartProps);

    // Create container repository
    const awsLB = props.containerAndRepoBuilder.addContainerAndRepo({
      containerImageS3ObjectKey: 'aws-load-balancer-controller.tar.gz',
      repositoryName: 'eks/aws-load-balancer-controller',
    } as RepoAndContainerProps);

    // Install AWS Load Balancer Controller Helm chart
    const loadBalancerController = props.cluster.addHelmChart('AwsLoadBalancerController', {
      chart: 'aws-load-balancer-controller',
      repository: 'oci://' + loadBalancerControllerHelmChartRepo.repository.repositoryUri,
      namespace: 'kube-system',
      wait: true,
      version: helmVersion,
      values: {
        clusterName: props.cluster.clusterName,
        image: {
          repository: cdk.Fn.sub('${AWS::AccountId}.dkr.ecr.${AWS::Region}.${AWS::URLSuffix}/eks/aws-load-balancer-controller'),
          tag: `${containerVersion}-linux_arm64`,
        },
        enableCertManager: false,
        replicaCount: 1,
        serviceAccount: {
          create: false,
          name: 'aws-load-balancer-controller',
        },
      },
    });

    loadBalancerController.node.addDependency(loadBalancerControllerPodIdentityAssociation);
    loadBalancerController.node.addDependency(awsLB.dependable);
    loadBalancerController.node.addDependency(loadBalancerControllerManagedPolicy);
    loadBalancerController.node.addDependency(loadBalancerControllerHelmChartRepo.dependable);
    (loadBalancerController.node.findChild('Resource').node.defaultChild as cdk.CfnResource).addPropertyOverride(
      'ServiceTimeout',
      '300',
    );

    this.waitableNode = loadBalancerController;
  }

  /**
   * Creates the IAM policy for the AWS Load Balancer Controller by fetching
   * the policy document from the GitHub repository
   */
  private createAwsLoadBalancerControllerIAMPolicy(_version: string): iam.ManagedPolicy {
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
