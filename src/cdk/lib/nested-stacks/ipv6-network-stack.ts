// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { IPAddressType } from '../constructs/ip-address-type';
import { NestedStackWithSource } from '../constructs/nested-stack-with-source';
import { VpcIpV6, IVpcIpV6 } from '../constructs/vpc-ipv6-construct';

/**
 * Props for IPv6 Network Stack
 */
export interface IpV6NetworkStackProps extends cdk.NestedStackProps {
  /**
   * Availability zone names for the VPC
   */
  readonly availabilityZoneNames: string[];
}

/**
 * Nested stack that creates a VPC with IPv6 support and VPC endpoints
 */
export class IpV6NetworkStack extends NestedStackWithSource {
  /**
   * The VPC with IPv6 support
   */
  public readonly vpc: IVpcIpV6;

  /**
   * Availability zone names
   */
  public readonly availabilityZoneNames: string[];

  constructor(scope: cdk.Stack, id: string, props: IpV6NetworkStackProps) {
    super(scope, id, props);

    this.availabilityZoneNames = props.availabilityZoneNames;

    // Check if IPv6 is enabled via context
    const ipV6Enabled = scope.node.tryGetContext('ipV6Enabled') === true;

    // Determine IP address type based on context
    const subnetIpConfiguration = ipV6Enabled ? IPAddressType.DualStack : IPAddressType.IPv4;

    // Create VPC with IPv6 support
    this.vpc = new VpcIpV6(this, 'vpc', {
      ipAddresses: ec2.IpAddresses.cidr('192.168.0.0/16'),
      enableDnsHostnames: true,
      enableDnsSupport: true,
      createInternetGateway: false,
      availabilityZones: props.availabilityZoneNames,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'isolated-subnet',
          subnetIpConfiguration,
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
      restrictDefaultSecurityGroup: false,
    });

    // Add S3 Gateway Endpoint
    this.vpc.addGatewayEndpoint('s3', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    // Add VPC Interface Endpoints
    this.vpc.addInterfaceEndpoint('vpcessm', {
      service: ec2.InterfaceVpcEndpointAwsService.SSM,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: true,
      open: true,
    });

    this.vpc.addInterfaceEndpoint('vpcessmmessages', {
      service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: true,
      open: true,
    });

    this.vpc.addInterfaceEndpoint('kms', {
      service: ec2.InterfaceVpcEndpointAwsService.KMS,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: true,
      open: true,
    });

    this.vpc.addInterfaceEndpoint('logs', {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: true,
      open: true,
    });

    this.vpc.addInterfaceEndpoint('cloudwatch', {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_MONITORING,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: true,
      open: true,
    });

    this.vpc.addInterfaceEndpoint('ec2messages', {
      service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: true,
      open: true,
    });

    this.vpc.addInterfaceEndpoint('cfn', {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDFORMATION,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: true,
      open: true,
    });

    this.vpc.addInterfaceEndpoint('xray', {
      service: ec2.InterfaceVpcEndpointAwsService.XRAY,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: true,
      open: true,
    });

    this.vpc.addInterfaceEndpoint('codedeploy', {
      service: ec2.InterfaceVpcEndpointAwsService.CODEDEPLOY,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: true,
      open: true,
    });

    this.vpc.addInterfaceEndpoint('codedeployagent', {
      service: ec2.InterfaceVpcEndpointAwsService.CODEDEPLOY_COMMANDS_SECURE,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: true,
      open: true,
    });

    this.vpc.addInterfaceEndpoint('secretsmanager', {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: true,
      open: true,
    });

    this.vpc.addInterfaceEndpoint('elasticloadbalancing', {
      service: ec2.InterfaceVpcEndpointAwsService.ELASTIC_LOAD_BALANCING,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: true,
      open: true,
    });

    this.vpc.addInterfaceEndpoint('sts', {
      service: ec2.InterfaceVpcEndpointAwsService.STS,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: true,
      open: true,
    });

    this.vpc.addInterfaceEndpoint('ec2', {
      service: ec2.InterfaceVpcEndpointAwsService.EC2,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: true,
      open: true,
    });

    this.vpc.addInterfaceEndpoint('ecrapi', {
      service: ec2.InterfaceVpcEndpointAwsService.ECR,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: true,
      open: true,
    });

    this.vpc.addInterfaceEndpoint('ecrdkr', {
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: true,
      open: true,
    });

    this.vpc.addInterfaceEndpoint('eks', {
      service: ec2.InterfaceVpcEndpointAwsService.EKS,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: true,
      open: true,
    });

    this.vpc.addInterfaceEndpoint('eksauth', {
      service: ec2.InterfaceVpcEndpointAwsService.EKS_AUTH,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: true,
      open: true,
    });

    this.vpc.addInterfaceEndpoint('autoscaling', {
      service: ec2.InterfaceVpcEndpointAwsService.AUTOSCALING,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: true,
      open: true,
    });

    this.vpc.addInterfaceEndpoint('lambda', {
      service: ec2.InterfaceVpcEndpointAwsService.LAMBDA,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: true,
      open: true,
    });

    this.vpc.addInterfaceEndpoint('stepfunctions', {
      service: ec2.InterfaceVpcEndpointAwsService.STEP_FUNCTIONS,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: true,
      open: true,
    });

    this.vpc.addInterfaceEndpoint('stepfunctionssync', {
      service: ec2.InterfaceVpcEndpointAwsService.STEP_FUNCTIONS_SYNC,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: true,
      open: true,
    });
  }
}
