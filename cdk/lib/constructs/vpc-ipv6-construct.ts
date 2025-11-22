// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { IPAddressType } from './ip-address-type';

/**
 * Interface for IPv6 subnet configuration
 */
export interface ISubnetIpV6Configuration extends ec2.SubnetConfiguration {
  /**
   * IP address type for the subnet
   * @default IPAddressType.DualStack
   */
  readonly subnetIpConfiguration?: IPAddressType;

  /**
   * Availability zone for the subnet
   * @default ''
   */
  readonly availabilityZone?: string;
}

/**
 * Props for VPC with IPv6 support
 */
export interface VpcIpV6Props extends ec2.VpcProps {
  /**
   * Subnet configurations with IPv6 support
   */
  readonly subnetConfiguration?: ISubnetIpV6Configuration[];

  /**
   * Disable custom resource creation
   * @default false
   */
  readonly disableCustomResourceCreation?: boolean;
}

/**
 * Interface for VPC with IPv6 capabilities
 */
export interface IVpcIpV6 extends ec2.IVpc {
  /**
   * Whether the VPC is IPv6 only
   */
  readonly ipV6Only: boolean;

  /**
   * Whether IPv6 is enabled
   */
  readonly ipV6Enabled: boolean;

  /**
   * VPC IPv6 CIDR blocks
   */
  readonly vpcIpv6CidrBlocks: string[];
}

/**
 * VPC construct with IPv6 support
 */
export class VpcIpV6 extends ec2.Vpc implements IVpcIpV6 {
  public readonly ipV6Only: boolean;
  public readonly ipV6Enabled: boolean;

  constructor(scope: Construct, id: string, props: VpcIpV6Props) {
    // Set default IP addresses if not provided
    const vpcProps: ec2.VpcProps = {
      ...props,
      ipAddresses: props.ipAddresses ?? ec2.IpAddresses.cidr('10.0.0.0/16'),
    };

    super(scope, id, vpcProps);

    const subnetConfig = props.subnetConfiguration ?? [];
    const dualStack = subnetConfig.some((x) => x.subnetIpConfiguration === IPAddressType.DualStack);
    const ipv6 = subnetConfig.some((x) => x.subnetIpConfiguration === IPAddressType.IPv6);

    this.ipV6Only = subnetConfig.every((x) => x.subnetIpConfiguration === IPAddressType.IPv6);
    this.ipV6Enabled = dualStack || ipv6;

    if (dualStack || ipv6) {
      // Create IPv6 CIDR block
      const ipv6Block = new ec2.CfnVPCCidrBlock(this, 'IPv6CidrBlock', {
        amazonProvidedIpv6CidrBlock: true,
        vpcId: this.vpcId,
      });

      const iPv6SubnetCidrBlocks = cdk.Fn.cidr(
        cdk.Fn.select(0, this.vpcIpv6CidrBlocks),
        256,
        '64'
      );

      let ipv6Counter = 0;

      // Configure public subnets
      for (const subnet of this.publicSubnets) {
        const config = subnetConfig.find((x) => x.subnetType === ec2.SubnetType.PUBLIC);
        subnet.node.addDependency(ipv6Block);

        const sub = subnet.node.defaultChild as ec2.CfnSubnet;
        sub.ipv6CidrBlock = cdk.Fn.select(ipv6Counter++, iPv6SubnetCidrBlocks);

        if (this.internetGatewayId) {
          (subnet as ec2.Subnet).addRoute('IPv6DefaultRoute', {
            destinationIpv6CidrBlock: '::/0',
            enablesInternetConnectivity: true,
            routerType: ec2.RouterType.GATEWAY,
            routerId: this.internetGatewayId,
          });
        }

        if (config?.subnetIpConfiguration === IPAddressType.IPv6) {
          sub.cidrBlock = undefined;
          sub.ipv6Native = true;
        }
      }

      // Configure private subnets with egress
      if (this.privateSubnets.length > 0) {
        const egw = new ec2.CfnEgressOnlyInternetGateway(this, 'EgressGateway', {
          vpcId: this.vpcId,
        });

        for (const subnet of this.privateSubnets) {
          const config = subnetConfig.find((x) => x.subnetType === ec2.SubnetType.PRIVATE_WITH_EGRESS);

          subnet.node.addDependency(ipv6Block);
          const sub = subnet.node.defaultChild as ec2.CfnSubnet;
          sub.ipv6CidrBlock = cdk.Fn.select(ipv6Counter++, iPv6SubnetCidrBlocks);

          (subnet as ec2.Subnet).addRoute('IPv6DefaultRoute', {
            destinationIpv6CidrBlock: '::/0',
            enablesInternetConnectivity: true,
            routerType: ec2.RouterType.GATEWAY,
            routerId: egw.attrId,
          });

          if (config?.subnetIpConfiguration === IPAddressType.IPv6) {
            sub.cidrBlock = undefined;
            sub.ipv6Native = true;
          }
        }
      }

      // Configure isolated subnets
      const isolatedSubnetConfig = subnetConfig.find((x) => x.subnetType === ec2.SubnetType.PRIVATE_ISOLATED);

      for (const subnet of this.isolatedSubnets) {
        subnet.node.addDependency(ipv6Block);
        const sub = subnet.node.defaultChild as ec2.CfnSubnet;
        sub.ipv6CidrBlock = cdk.Fn.select(ipv6Counter++, iPv6SubnetCidrBlocks);

        if (isolatedSubnetConfig?.subnetIpConfiguration === IPAddressType.IPv6) {
          sub.cidrBlock = undefined;
          sub.ipv6Native = true;
        }
      }
    }

    // Output availability zones
    new cdk.CfnOutput(this, 'AvailabilityZones', {
      value: cdk.Fn.join(',', props.availabilityZones ?? []),
      exportName: cdk.Fn.sub('${AWS::StackName}-AvailabilityZones'),
    });

    // Output IPv6 CIDR blocks if enabled
    if (this.ipV6Enabled) {
      new cdk.CfnOutput(this, 'VpcIpv6CidrBlocks', {
        value: cdk.Fn.join(',', this.vpcIpv6CidrBlocks),
      });
    }
  }
}
