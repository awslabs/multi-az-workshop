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

    const interfaceEndpoints: ec2.InterfaceVpcEndpointAwsService[] = [
      ec2.InterfaceVpcEndpointAwsService.SSM,
      ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
      ec2.InterfaceVpcEndpointAwsService.KMS,
      ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_MONITORING,
      ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
      ec2.InterfaceVpcEndpointAwsService.CLOUDFORMATION,
      ec2.InterfaceVpcEndpointAwsService.XRAY,
      ec2.InterfaceVpcEndpointAwsService.CODEDEPLOY,
      ec2.InterfaceVpcEndpointAwsService.CODEDEPLOY_COMMANDS_SECURE,
      ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      ec2.InterfaceVpcEndpointAwsService.ELASTIC_LOAD_BALANCING,
      ec2.InterfaceVpcEndpointAwsService.STS,
      ec2.InterfaceVpcEndpointAwsService.EC2,
      ec2.InterfaceVpcEndpointAwsService.ECR,
      ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      ec2.InterfaceVpcEndpointAwsService.EKS,
      ec2.InterfaceVpcEndpointAwsService.EKS_AUTH,
      ec2.InterfaceVpcEndpointAwsService.AUTOSCALING,
      ec2.InterfaceVpcEndpointAwsService.LAMBDA,
      ec2.InterfaceVpcEndpointAwsService.STEP_FUNCTIONS,
      ec2.InterfaceVpcEndpointAwsService.STEP_FUNCTIONS_SYNC
    ]

    interfaceEndpoints.forEach(endpoint => {
      this.vpc.addInterfaceEndpoint(endpoint.shortName + "vpce", {
        service: endpoint,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        privateDnsEnabled: true,
        open: true,
      });
    });
  }
}
