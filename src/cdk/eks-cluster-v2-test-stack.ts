#!/usr/bin/env node
// Standalone test stack for EKS Cluster V2 construct

import * as eks from '@aws-cdk/aws-eks-v2-alpha';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { EKSClusterV2, InstanceArchitecture } from './lib/constructs/eks-cluster';

const app = new cdk.App({
  outdir: process.env.CDK_OUTDIR ?? 'cdk.out.test',
});

const stack = new cdk.Stack(app, 'EKSClusterV2TestStack', {
  env: {
    account: '386526219917',
    region: 'us-east-2',
  },
  synthesizer: new cdk.DefaultStackSynthesizer({
    fileAssetsBucketName: '${AssetsBucketName}',
    bucketPrefix: '${AssetsBucketPrefix}',
    qualifier: undefined,
    generateBootstrapVersionRule: false,
  }),
});

new cdk.CfnParameter(stack, 'AssetsBucketName', {
  type: 'String',
  description: 'S3 bucket for CloudFormation assets',
});

new cdk.CfnParameter(stack, 'AssetsBucketPrefix', {
  type: 'String',
  description: 'S3 prefix for CloudFormation assets',
});

const vpc = new ec2.Vpc(stack, 'VPC', {
  availabilityZones: ['us-east-2a', 'us-east-2b', 'us-east-2c'],
  natGateways: 0,
  subnetConfiguration: [
    { name: 'Isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  ],
});

// Add S3 Gateway Endpoint
vpc.addGatewayEndpoint('s3', {
  service: ec2.GatewayVpcEndpointAwsService.S3,
});
// Add VPC Interface Endpoints
vpc.addInterfaceEndpoint('vpcessm', {
  service: ec2.InterfaceVpcEndpointAwsService.SSM,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  privateDnsEnabled: true,
  open: true,
});
vpc.addInterfaceEndpoint('vpcessmmessages', {
  service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  privateDnsEnabled: true,
  open: true,
});
vpc.addInterfaceEndpoint('kms', {
  service: ec2.InterfaceVpcEndpointAwsService.KMS,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  privateDnsEnabled: true,
  open: true,
});
vpc.addInterfaceEndpoint('logs', {
  service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  privateDnsEnabled: true,
  open: true,
});
vpc.addInterfaceEndpoint('cloudwatch', {
  service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_MONITORING,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  privateDnsEnabled: true,
  open: true,
});
vpc.addInterfaceEndpoint('ec2messages', {
  service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  privateDnsEnabled: true,
  open: true,
});
vpc.addInterfaceEndpoint('cfn', {
  service: ec2.InterfaceVpcEndpointAwsService.CLOUDFORMATION,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  privateDnsEnabled: true,
  open: true,
});
vpc.addInterfaceEndpoint('xray', {
  service: ec2.InterfaceVpcEndpointAwsService.XRAY,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  privateDnsEnabled: true,
  open: true,
});
vpc.addInterfaceEndpoint('codedeploy', {
  service: ec2.InterfaceVpcEndpointAwsService.CODEDEPLOY,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  privateDnsEnabled: true,
  open: true,
});
vpc.addInterfaceEndpoint('codedeployagent', {
  service: ec2.InterfaceVpcEndpointAwsService.CODEDEPLOY_COMMANDS_SECURE,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  privateDnsEnabled: true,
  open: true,
});
vpc.addInterfaceEndpoint('secretsmanager', {
  service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  privateDnsEnabled: true,
  open: true,
});
vpc.addInterfaceEndpoint('elasticloadbalancing', {
  service: ec2.InterfaceVpcEndpointAwsService.ELASTIC_LOAD_BALANCING,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  privateDnsEnabled: true,
  open: true,
});
vpc.addInterfaceEndpoint('sts', {
  service: ec2.InterfaceVpcEndpointAwsService.STS,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  privateDnsEnabled: true,
  open: true,
});
vpc.addInterfaceEndpoint('ec2', {
  service: ec2.InterfaceVpcEndpointAwsService.EC2,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  privateDnsEnabled: true,
  open: true,
});
vpc.addInterfaceEndpoint('ecrapi', {
  service: ec2.InterfaceVpcEndpointAwsService.ECR,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  privateDnsEnabled: true,
  open: true,
});
vpc.addInterfaceEndpoint('ecrdkr', {
  service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  privateDnsEnabled: true,
  open: true,
});
vpc.addInterfaceEndpoint('eks', {
  service: ec2.InterfaceVpcEndpointAwsService.EKS,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  privateDnsEnabled: true,
  open: true,
});
vpc.addInterfaceEndpoint('eksauth', {
  service: ec2.InterfaceVpcEndpointAwsService.EKS_AUTH,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  privateDnsEnabled: true,
  open: true,
});
vpc.addInterfaceEndpoint('autoscaling', {
  service: ec2.InterfaceVpcEndpointAwsService.AUTOSCALING,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  privateDnsEnabled: true,
  open: true,
});
vpc.addInterfaceEndpoint('lambda', {
  service: ec2.InterfaceVpcEndpointAwsService.LAMBDA,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  privateDnsEnabled: true,
  open: true,
});
vpc.addInterfaceEndpoint('stepfunctions', {
  service: ec2.InterfaceVpcEndpointAwsService.STEP_FUNCTIONS,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  privateDnsEnabled: true,
  open: true,
});
vpc.addInterfaceEndpoint('stepfunctionssync', {
  service: ec2.InterfaceVpcEndpointAwsService.STEP_FUNCTIONS_SYNC,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  privateDnsEnabled: true,
  open: true,
});

const adminRole = iam.Role.fromRoleName(stack, 'AdminRole', 'Admin');

const lbSecurityGroup = new ec2.SecurityGroup(stack, 'LBSecurityGroup', {
  vpc,
  description: 'Load balancer security group',
});

new EKSClusterV2(stack, 'EKSClusterV2', {
  vpc,
  cpuArch: InstanceArchitecture.ARM_64,
  adminRole,
  loadBalancerSecurityGroup: lbSecurityGroup,
  clusterName: 'eks-v2-test-cluster',
  version: eks.KubernetesVersion.of('1.35'),
});

app.synth();
