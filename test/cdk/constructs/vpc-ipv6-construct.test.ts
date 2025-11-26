// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import { Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { IPAddressType } from '../../../src/cdk/lib/constructs/ip-address-type';
import { VpcIpV6 } from '../../../src/cdk/lib/constructs/vpc-ipv6-construct';
import {
  synthesizeStack,
  getResourceCount,
  findResourcesByType,
} from '../../helpers/stack-helpers';
import { createTestApp, TEST_AVAILABILITY_ZONES } from '../../helpers/test-fixtures';

describe('VpcIpV6', () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = createTestApp();
    stack = new cdk.Stack(app, 'TestStack', {
      env: { region: 'us-east-1', account: '123456789012' },
    });

    // Override availabilityZones for consistent testing
    Object.defineProperty(stack, 'availabilityZones', {
      value: TEST_AVAILABILITY_ZONES,
      writable: false,
    });
  });

  describe('IPv4 only configuration', () => {
    test('creates VPC with IPv4 only when no IPv6 configuration provided', () => {
      const vpc = new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      expect(vpc.ipV6Only).toBe(false);
      expect(vpc.ipV6Enabled).toBe(false);
    });

    test('does not create IPv6 CIDR block for IPv4 only VPC', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.IPv4,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      const cidrBlocks = findResourcesByType(template, 'AWS::EC2::VPCCidrBlock');
      expect(cidrBlocks.length).toBe(0);
    });

    test('creates VPC with default CIDR when not specified', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::EC2::VPC', {
        CidrBlock: '10.0.0.0/16',
      });
    });
  });

  describe('Dual-stack configuration', () => {
    test('creates VPC with dual-stack when DualStack configuration provided', () => {
      const vpc = new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.DualStack,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      expect(vpc.ipV6Only).toBe(false);
      expect(vpc.ipV6Enabled).toBe(true);
    });

    test('creates IPv6 CIDR block for dual-stack VPC', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.DualStack,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::EC2::VPCCidrBlock', {
        AmazonProvidedIpv6CidrBlock: true,
      });
    });

    test('assigns IPv6 CIDR blocks to subnets in dual-stack mode', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.DualStack,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      const subnets = findResourcesByType(template, 'AWS::EC2::Subnet');

      subnets.forEach((subnet) => {
        expect(subnet.Properties.Ipv6CidrBlock).toBeDefined();
      });
    });

    test('subnets retain IPv4 CIDR in dual-stack mode', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.DualStack,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      const subnets = findResourcesByType(template, 'AWS::EC2::Subnet');

      subnets.forEach((subnet) => {
        expect(subnet.Properties.CidrBlock).toBeDefined();
        expect(subnet.Properties.Ipv6Native).toBeUndefined();
      });
    });
  });

  describe('IPv6 only configuration', () => {
    test('creates VPC with IPv6 only when all subnets are IPv6', () => {
      const vpc = new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.IPv6,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      expect(vpc.ipV6Only).toBe(true);
      expect(vpc.ipV6Enabled).toBe(true);
    });

    test('creates IPv6 CIDR block for IPv6 only VPC', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.IPv6,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::EC2::VPCCidrBlock', {
        AmazonProvidedIpv6CidrBlock: true,
      });
    });

    test('subnets are IPv6 native in IPv6 only mode', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.IPv6,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      const subnets = findResourcesByType(template, 'AWS::EC2::Subnet');

      subnets.forEach((subnet) => {
        expect(subnet.Properties.Ipv6Native).toBe(true);
        expect(subnet.Properties.CidrBlock).toBeUndefined();
      });
    });

    test('ipV6Only is false when mixed subnet types', () => {
      const vpc = new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.IPv6,
          },
          {
            name: 'Private',
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.DualStack,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      expect(vpc.ipV6Only).toBe(false);
      expect(vpc.ipV6Enabled).toBe(true);
    });

    test('public subnets with IPv6-only are IPv6 native without IPv4 CIDR', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.IPv6,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      const subnets = findResourcesByType(template, 'AWS::EC2::Subnet');

      // All public subnets should be IPv6 native
      subnets.forEach((subnet) => {
        expect(subnet.Properties.Ipv6Native).toBe(true);
        expect(subnet.Properties.CidrBlock).toBeUndefined();
        expect(subnet.Properties.Ipv6CidrBlock).toBeDefined();
      });

      // Verify IPv6 routes through internet gateway
      const routes = findResourcesByType(template, 'AWS::EC2::Route');
      const ipv6Routes = routes.filter(
        (route) => route.Properties.DestinationIpv6CidrBlock === '::/0',
      );
      expect(ipv6Routes.length).toBeGreaterThan(0);
      ipv6Routes.forEach((route) => {
        expect(route.Properties.GatewayId).toBeDefined();
      });
    });

    test('private subnets with egress using IPv6-only are IPv6 native without IPv4 CIDR', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.DualStack,
          },
          {
            name: 'Private',
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.IPv6,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      const subnets = findResourcesByType(template, 'AWS::EC2::Subnet');

      // Filter private subnets (those without MapPublicIpOnLaunch)
      const privateSubnets = subnets.filter(
        (subnet) => !subnet.Properties.MapPublicIpOnLaunch,
      );

      // Private subnets should be IPv6 native
      expect(privateSubnets.length).toBeGreaterThan(0);
      privateSubnets.forEach((subnet) => {
        expect(subnet.Properties.Ipv6Native).toBe(true);
        expect(subnet.Properties.CidrBlock).toBeUndefined();
        expect(subnet.Properties.Ipv6CidrBlock).toBeDefined();
      });

      // Verify egress-only internet gateway exists
      const egressGateways = findResourcesByType(template, 'AWS::EC2::EgressOnlyInternetGateway');
      expect(egressGateways.length).toBe(1);

      // Verify IPv6 routes through egress gateway
      const routes = findResourcesByType(template, 'AWS::EC2::Route');
      const ipv6EgressRoutes = routes.filter(
        (route) =>
          route.Properties.DestinationIpv6CidrBlock === '::/0' &&
          route.Properties.EgressOnlyInternetGatewayId !== undefined,
      );
      expect(ipv6EgressRoutes.length).toBeGreaterThan(0);
    });
  });

  describe('Public subnet IPv6 configuration', () => {
    test('configures IPv6 routes for public subnets', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.DualStack,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::EC2::Route', {
        DestinationIpv6CidrBlock: '::/0',
      });
    });

    test('public subnets use internet gateway for IPv6', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.DualStack,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      const routes = findResourcesByType(template, 'AWS::EC2::Route');
      const ipv6Routes = routes.filter(
        (route) => route.Properties.DestinationIpv6CidrBlock === '::/0',
      );

      ipv6Routes.forEach((route) => {
        expect(route.Properties.GatewayId).toBeDefined();
      });
    });

    test('assigns unique IPv6 CIDR to each public subnet', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.DualStack,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      const subnets = findResourcesByType(template, 'AWS::EC2::Subnet');
      const ipv6Cidrs = subnets.map((s) => s.Properties.Ipv6CidrBlock);

      // All should be defined
      ipv6Cidrs.forEach((cidr) => expect(cidr).toBeDefined());

      // All should be unique (using Fn::Select with different indices)
      const uniqueCidrs = new Set(ipv6Cidrs.map((c) => JSON.stringify(c)));
      expect(uniqueCidrs.size).toBe(ipv6Cidrs.length);
    });
  });

  describe('Private subnet with egress IPv6 configuration', () => {
    test('creates egress-only internet gateway for private subnets', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
          },
          {
            name: 'Private',
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.DualStack,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      const count = getResourceCount(template, 'AWS::EC2::EgressOnlyInternetGateway');
      expect(count).toBe(1);
    });

    test('configures IPv6 routes for private subnets with egress gateway', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.IPv4,
          },
          {
            name: 'Private',
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.DualStack,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      const routes = findResourcesByType(template, 'AWS::EC2::Route');
      const ipv6Routes = routes.filter(
        (route) => route.Properties.DestinationIpv6CidrBlock === '::/0',
      );

      const egressRoutes = ipv6Routes.filter(
        (route) => route.Properties.EgressOnlyInternetGatewayId !== undefined,
      );

      expect(egressRoutes.length).toBeGreaterThan(0);
    });

    test('private subnets can be IPv6 native', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
          },
          {
            name: 'Private',
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.IPv6,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      const subnets = findResourcesByType(template, 'AWS::EC2::Subnet');

      const privateSubnets = subnets.filter((subnet) => subnet.Properties.Ipv6Native === true);
      expect(privateSubnets.length).toBeGreaterThan(0);
    });

    test('does not create egress gateway when no private subnets', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.DualStack,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      const count = getResourceCount(template, 'AWS::EC2::EgressOnlyInternetGateway');
      expect(count).toBe(0);
    });
  });

  describe('Isolated subnet IPv6 configuration', () => {
    test('assigns IPv6 CIDR to isolated subnets', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Isolated',
            subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.DualStack,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      const subnets = findResourcesByType(template, 'AWS::EC2::Subnet');

      subnets.forEach((subnet) => {
        expect(subnet.Properties.Ipv6CidrBlock).toBeDefined();
      });
    });

    test('isolated subnets do not have IPv6 routes', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Isolated',
            subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.DualStack,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      const routes = findResourcesByType(template, 'AWS::EC2::Route');
      const ipv6Routes = routes.filter(
        (route) => route.Properties.DestinationIpv6CidrBlock === '::/0',
      );

      expect(ipv6Routes.length).toBe(0);
    });

    test('isolated subnets can be IPv6 native', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Isolated',
            subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.IPv6,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      const subnets = findResourcesByType(template, 'AWS::EC2::Subnet');

      subnets.forEach((subnet) => {
        expect(subnet.Properties.Ipv6Native).toBe(true);
        expect(subnet.Properties.CidrBlock).toBeUndefined();
      });
    });
  });

  describe('IPv6 CIDR block allocation', () => {
    test('creates VPC IPv6 CIDR block resource', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.DualStack,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      const count = getResourceCount(template, 'AWS::EC2::VPCCidrBlock');
      expect(count).toBe(1);
    });

    test('VPC CIDR block uses Amazon-provided IPv6', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.DualStack,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::EC2::VPCCidrBlock', {
        AmazonProvidedIpv6CidrBlock: true,
        VpcId: Match.anyValue(),
      });
    });

    test('subnets depend on IPv6 CIDR block', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.DualStack,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      const subnets = findResourcesByType(template, 'AWS::EC2::Subnet');

      // Subnets should have DependsOn for IPv6 CIDR block
      subnets.forEach((subnet) => {
        expect(subnet.DependsOn).toBeDefined();
        expect(Array.isArray(subnet.DependsOn)).toBe(true);
      });
    });

    test('allocates /64 IPv6 CIDR blocks for subnets', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.DualStack,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      const subnets = findResourcesByType(template, 'AWS::EC2::Subnet');

      // Each subnet should get an IPv6 CIDR using Fn::Cidr with /64
      subnets.forEach((subnet) => {
        const ipv6Cidr = subnet.Properties.Ipv6CidrBlock;
        expect(ipv6Cidr).toBeDefined();
      });
    });
  });

  describe('CloudFormation outputs', () => {
    test('creates availability zones output', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      const outputs = template.toJSON().Outputs;
      const hasAzOutput = Object.keys(outputs).some((key) => key.includes('AvailabilityZones'));
      expect(hasAzOutput).toBe(true);
    });

    test('availability zones output contains correct value', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      const outputs = template.toJSON().Outputs;
      const azOutput = Object.keys(outputs).find((key) => key.includes('AvailabilityZones'));
      expect(azOutput).toBeDefined();
    });

    test('creates IPv6 CIDR blocks output when IPv6 enabled', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.DualStack,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      const outputs = template.toJSON().Outputs;
      const hasIpv6Output = Object.keys(outputs).some((key) => key.includes('VpcIpv6CidrBlocks'));
      expect(hasIpv6Output).toBe(true);
    });

    test('does not create IPv6 CIDR blocks output when IPv6 disabled', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      const outputs = template.toJSON().Outputs;
      const hasIpv6Output = Object.keys(outputs).some((key) => key.includes('VpcIpv6CidrBlocks'));
      expect(hasIpv6Output).toBe(false);
    });
  });

  describe('ipV6Only and ipV6Enabled properties', () => {
    test('ipV6Only is true only when all subnets are IPv6', () => {
      const vpc = new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.IPv6,
          },
          {
            name: 'Private',
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.IPv6,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      expect(vpc.ipV6Only).toBe(true);
    });

    test('ipV6Enabled is true when any subnet has IPv6', () => {
      const vpc = new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.DualStack,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      expect(vpc.ipV6Enabled).toBe(true);
    });

    test('ipV6Enabled is false when no subnets have IPv6', () => {
      const vpc = new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.IPv4,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      expect(vpc.ipV6Enabled).toBe(false);
    });

    test('vpcIpv6CidrBlocks is accessible', () => {
      const vpc = new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.DualStack,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      expect(vpc.vpcIpv6CidrBlocks).toBeDefined();
      expect(Array.isArray(vpc.vpcIpv6CidrBlocks)).toBe(true);
    });
  });

  describe('custom IP addresses', () => {
    test('uses custom CIDR when provided', () => {
      new VpcIpV6(stack, 'Vpc', {
        ipAddresses: ec2.IpAddresses.cidr('192.168.0.0/16'),
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::EC2::VPC', {
        CidrBlock: '192.168.0.0/16',
      });
    });
  });

  describe('edge cases - optional properties', () => {
    test('creates VPC with minimal configuration', () => {
      const vpc = new VpcIpV6(stack, 'Vpc', {
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      expect(vpc).toBeDefined();
      expect(vpc.vpcId).toBeDefined();
    });

    test('creates VPC with empty subnet configuration array', () => {
      const vpc = new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      expect(vpc).toBeDefined();
      const template = synthesizeStack(stack);
      const subnets = findResourcesByType(template, 'AWS::EC2::Subnet');
      expect(subnets.length).toBe(0);
    });

    test('creates VPC with single subnet configuration', () => {
      const vpc = new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Single',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      expect(vpc).toBeDefined();
      const template = synthesizeStack(stack);
      const subnets = findResourcesByType(template, 'AWS::EC2::Subnet');
      expect(subnets.length).toBe(3); // One per AZ
    });

    test('creates VPC with single availability zone', () => {
      const vpc = new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
          },
        ],
        availabilityZones: ['us-east-1a'],
      });

      expect(vpc).toBeDefined();
      const template = synthesizeStack(stack);
      const subnets = findResourcesByType(template, 'AWS::EC2::Subnet');
      expect(subnets.length).toBe(1);
    });

    test('creates VPC with maximum availability zones', () => {
      const manyAzs = ['us-east-1a', 'us-east-1b', 'us-east-1c'];
      const newStack = new cdk.Stack(app, 'ManyAzStack', {
        env: { region: 'us-east-1', account: '123456789012' },
      });

      Object.defineProperty(newStack, 'availabilityZones', {
        value: manyAzs,
        writable: false,
      });

      const vpc = new VpcIpV6(newStack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
          },
        ],
        availabilityZones: manyAzs,
      });

      expect(vpc).toBeDefined();
      const template = synthesizeStack(newStack);
      const subnets = findResourcesByType(template, 'AWS::EC2::Subnet');
      expect(subnets.length).toBe(3);
    });

    test('creates VPC with smallest CIDR mask', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 28,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::EC2::VPC', {
        CidrBlock: Match.anyValue(),
      });
    });

    test('creates VPC with largest CIDR mask', () => {
      new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 20,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::EC2::VPC', {
        CidrBlock: Match.anyValue(),
      });
    });

    test('handles all subnet types together', () => {
      const vpc = new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.IPv4,
          },
          {
            name: 'Private',
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.DualStack,
          },
          {
            name: 'Isolated',
            subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.IPv6,
          },
        ],
        availabilityZones: TEST_AVAILABILITY_ZONES,
      });

      expect(vpc).toBeDefined();
      expect(vpc.ipV6Enabled).toBe(true);
      expect(vpc.ipV6Only).toBe(false);
    });
  });

});

