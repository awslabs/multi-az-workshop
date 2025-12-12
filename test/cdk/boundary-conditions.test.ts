// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Boundary condition tests for CDK constructs
 * Tests numeric properties at boundaries, collection properties with various sizes,
 * and string properties with edge cases
 */

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { EnhancedApplicationLoadBalancer } from '../../src/cdk/lib/constructs/enhanced-load-balancer';
import { IPAddressType } from '../../src/cdk/lib/constructs/ip-address-type';
import { CidrBlock, NetworkBuilder } from '../../src/cdk/lib/constructs/network-builder';
import { VpcIpV6 } from '../../src/cdk/lib/constructs/vpc-ipv6-construct';
import { createMockVpc, createMockSubnets } from '../helpers/mock-factories';
import { createTestApp, TEST_AVAILABILITY_ZONES } from '../helpers/test-fixtures';

describe('Boundary Conditions', () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = createTestApp();
    stack = new cdk.Stack(app, 'TestStack', {
      env: { region: 'us-east-1', account: '123456789012' },
    });
  });

  describe('Numeric property boundaries', () => {
    describe('CIDR mask boundaries', () => {
      test('handles minimum valid mask (16)', () => {
        const builder = new NetworkBuilder('10.0.0.0/16');
        const subnet = builder.addSubnet(16);

        expect(subnet).toBe('10.0.0.0/16');
      });

      test('handles maximum valid mask (28)', () => {
        const builder = new NetworkBuilder('10.0.0.0/16');
        const subnet = builder.addSubnet(28);

        expect(subnet).toBe('10.0.0.0/28');
      });

      test('rejects mask below minimum (15)', () => {
        const builder = new NetworkBuilder('10.0.0.0/16');

        expect(() => builder.addSubnet(15)).toThrow('is not a valid network mask');
      });

      test('rejects mask above maximum (29)', () => {
        const builder = new NetworkBuilder('10.0.0.0/16');

        expect(() => builder.addSubnet(29)).toThrow('is not a valid network mask');
      });
    });

    describe('IP address number boundaries', () => {
      test('handles minimum IP number (0)', () => {
        const ip = CidrBlock.numberToIp(0);

        expect(ip).toBe('0.0.0.0');
      });

      test('handles maximum IP number (4294967295)', () => {
        const ip = CidrBlock.numberToIp(4294967295);

        expect(ip).toBe('255.255.255.255');
      });

      test('rejects IP number below minimum (-1)', () => {
        expect(() => CidrBlock.numberToIp(-1)).toThrow('is not a valid IP address');
      });

      test('rejects IP number above maximum (4294967296)', () => {
        expect(() => CidrBlock.numberToIp(4294967296)).toThrow('is not a valid IP address');
      });
    });

    describe('IP octet boundaries', () => {
      test('handles minimum octet value (0)', () => {
        expect(() => CidrBlock.ipToNumber('0.0.0.0')).not.toThrow();
      });

      test('handles maximum octet value (255)', () => {
        expect(() => CidrBlock.ipToNumber('255.255.255.255')).not.toThrow();
      });

      test('rejects octet below minimum (-1)', () => {
        expect(() => CidrBlock.ipToNumber('10.0.-1.0')).toThrow('is not a valid IP address');
      });

      test('rejects octet above maximum (256)', () => {
        expect(() => CidrBlock.ipToNumber('256.0.0.0')).toThrow('is not a valid IP address');
      });
    });

    describe('Network size boundaries', () => {
      test('handles minimum network size (1 IP for /32)', () => {
        const cidr = new CidrBlock('192.168.1.1/32');

        expect(cidr.networkSize).toBe(1);
      });

      test('handles maximum network size (entire IPv4 space for /0)', () => {
        const cidr = new CidrBlock('0.0.0.0/0');

        expect(cidr.networkSize).toBe(4294967296);
      });

      test('handles /31 network (2 IPs)', () => {
        const cidr = new CidrBlock('192.168.1.0/31');

        expect(cidr.networkSize).toBe(2);
      });

      test('handles /1 network (half of IPv4 space)', () => {
        const cidr = new CidrBlock('0.0.0.0/1');

        expect(cidr.networkSize).toBe(2147483648);
      });
    });

    describe('Subnet count boundaries', () => {
      test('handles zero subnets', () => {
        const builder = new NetworkBuilder('10.0.0.0/16');
        const subnets = builder.addSubnets(24, 0);

        expect(subnets).toHaveLength(0);
      });

      test('handles single subnet', () => {
        const builder = new NetworkBuilder('10.0.0.0/16');
        const subnets = builder.addSubnets(24, 1);

        expect(subnets).toHaveLength(1);
      });

      test('handles maximum subnets for /16 with /24 subnets (256)', () => {
        const builder = new NetworkBuilder('10.0.0.0/16');
        const subnets = builder.addSubnets(24, 256);

        expect(subnets).toHaveLength(256);
      });

      test('handles maximum subnets for /16 with /28 subnets (4096)', () => {
        const builder = new NetworkBuilder('10.0.0.0/16');
        const subnets = builder.addSubnets(28, 4096);

        expect(subnets).toHaveLength(4096);
      });
    });
  });

  describe('Collection property boundaries', () => {
    describe('Availability zones', () => {
      test('handles single availability zone', () => {
        Object.defineProperty(stack, 'availabilityZones', {
          value: ['us-east-1a'],
          writable: false,
        });

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

        expect(vpc.availabilityZones).toHaveLength(1);
      });

      test('handles two availability zones', () => {
        Object.defineProperty(stack, 'availabilityZones', {
          value: ['us-east-1a', 'us-east-1b'],
          writable: false,
        });

        const vpc = new VpcIpV6(stack, 'Vpc', {
          subnetConfiguration: [
            {
              name: 'Public',
              subnetType: ec2.SubnetType.PUBLIC,
              cidrMask: 24,
            },
          ],
          availabilityZones: ['us-east-1a', 'us-east-1b'],
        });

        expect(vpc.availabilityZones).toHaveLength(2);
      });

      test('handles maximum availability zones (6)', () => {
        const manyAzs = ['us-east-1a', 'us-east-1b', 'us-east-1c', 'us-east-1d', 'us-east-1e', 'us-east-1f'];
        Object.defineProperty(stack, 'availabilityZones', {
          value: manyAzs,
          writable: false,
        });

        const vpc = new VpcIpV6(stack, 'Vpc', {
          subnetConfiguration: [
            {
              name: 'Public',
              subnetType: ec2.SubnetType.PUBLIC,
              cidrMask: 24,
            },
          ],
          availabilityZones: manyAzs,
        });

        expect(vpc.availabilityZones).toHaveLength(6);
      });
    });

    describe('Subnet configurations', () => {
      test('handles empty subnet configuration array', () => {
        Object.defineProperty(stack, 'availabilityZones', {
          value: TEST_AVAILABILITY_ZONES,
          writable: false,
        });

        const vpc = new VpcIpV6(stack, 'Vpc', {
          subnetConfiguration: [],
          availabilityZones: TEST_AVAILABILITY_ZONES,
        });

        expect(vpc).toBeDefined();
        const template = Template.fromStack(stack);
        const subnets = template.findResources('AWS::EC2::Subnet');
        expect(Object.keys(subnets)).toHaveLength(0);
      });

      test('handles single subnet configuration', () => {
        Object.defineProperty(stack, 'availabilityZones', {
          value: TEST_AVAILABILITY_ZONES,
          writable: false,
        });

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
      });

      test('handles multiple subnet configurations (3)', () => {
        Object.defineProperty(stack, 'availabilityZones', {
          value: TEST_AVAILABILITY_ZONES,
          writable: false,
        });

        const vpc = new VpcIpV6(stack, 'Vpc', {
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
            },
            {
              name: 'Isolated',
              subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
              cidrMask: 24,
            },
          ],
          availabilityZones: TEST_AVAILABILITY_ZONES,
        });

        expect(vpc).toBeDefined();
      });
    });

    describe('Subnets for load balancer', () => {
      test('handles load balancer with minimum subnets (1)', () => {
        const vpc = createMockVpc(stack, { azCount: 1, vpcName: 'SingleAzVpc' });
        const alb = new EnhancedApplicationLoadBalancer(stack, 'ALB', {
          vpc,
          internetFacing: true,
        });

        expect(alb.subnets.length).toBeGreaterThanOrEqual(1);
      });

      test('handles load balancer with two subnets', () => {
        const vpc = createMockVpc(stack, { azCount: 2, vpcName: 'TwoAzVpc' });
        const alb = new EnhancedApplicationLoadBalancer(stack, 'ALB', {
          vpc,
          internetFacing: true,
        });

        expect(alb.subnets.length).toBeGreaterThanOrEqual(2);
      });

      test('handles load balancer with many subnets (6)', () => {
        const vpc = createMockVpc(stack, { azCount: 6, vpcName: 'ManyAzVpc' });
        const alb = new EnhancedApplicationLoadBalancer(stack, 'ALB', {
          vpc,
          internetFacing: true,
        });

        expect(alb.subnets.length).toBeGreaterThanOrEqual(3);
      });

      test('handles explicit subnet selection with single subnet', () => {
        const vpc = createMockVpc(stack);
        const subnets = createMockSubnets(stack, vpc, 1);
        const alb = new EnhancedApplicationLoadBalancer(stack, 'ALB', {
          vpc,
          internetFacing: true,
          vpcSubnets: { subnets },
        });

        expect(alb.subnets.length).toBe(1);
      });
    });
  });

  describe('String property boundaries', () => {
    describe('CIDR string formats', () => {
      test('handles shortest valid CIDR (0.0.0.0/0)', () => {
        const cidr = new CidrBlock('0.0.0.0/0');

        expect(cidr.cidr).toBe('0.0.0.0/0');
      });

      test('handles longest valid CIDR (255.255.255.255/32)', () => {
        const cidr = new CidrBlock('255.255.255.255/32');

        expect(cidr.cidr).toBe('255.255.255.255/32');
      });

      test('handles CIDR with single-digit mask', () => {
        const cidr = new CidrBlock('10.0.0.0/8');

        expect(cidr.mask).toBe(8);
      });

      test('handles CIDR with double-digit mask', () => {
        const cidr = new CidrBlock('10.0.0.0/24');

        expect(cidr.mask).toBe(24);
      });
    });

    describe('IP address string formats', () => {
      test('handles IP with all zeros', () => {
        expect(CidrBlock.ipToNumber('0.0.0.0')).toBe(0);
      });

      test('handles IP with all 255s', () => {
        expect(CidrBlock.ipToNumber('255.255.255.255')).toBe(4294967295);
      });

      test('handles IP with mixed single and triple digit octets', () => {
        expect(() => CidrBlock.ipToNumber('1.22.255.4')).not.toThrow();
      });

      test('handles IP with leading zeros in octets', () => {
        expect(() => CidrBlock.ipToNumber('010.020.030.040')).not.toThrow();
      });

      test('rejects empty IP string', () => {
        expect(CidrBlock.isValidIp('')).toBe(false);
      });

      test('rejects IP with only dots', () => {
        expect(CidrBlock.isValidIp('...')).toBe(false);
      });

      test('rejects IP with trailing dot', () => {
        expect(CidrBlock.isValidIp('10.0.0.0.')).toBe(false);
      });

      test('rejects IP with leading dot', () => {
        expect(CidrBlock.isValidIp('.10.0.0.0')).toBe(false);
      });
    });

    describe('Load balancer name boundaries', () => {
      test('handles short load balancer name', () => {
        const vpc = createMockVpc(stack);
        const alb = new EnhancedApplicationLoadBalancer(stack, 'ALB', {
          vpc,
          internetFacing: true,
          loadBalancerName: 'a',
        });

        expect(alb).toBeDefined();
      });

      test('handles long load balancer name (32 chars - AWS limit)', () => {
        const vpc = createMockVpc(stack);
        const longName = 'a'.repeat(32);
        const alb = new EnhancedApplicationLoadBalancer(stack, 'ALB', {
          vpc,
          internetFacing: true,
          loadBalancerName: longName,
        });

        expect(alb).toBeDefined();
      });

      test('handles load balancer name with hyphens', () => {
        const vpc = createMockVpc(stack);
        const alb = new EnhancedApplicationLoadBalancer(stack, 'ALB', {
          vpc,
          internetFacing: true,
          loadBalancerName: 'my-load-balancer',
        });

        expect(alb).toBeDefined();
      });
    });

    describe('VPC name boundaries', () => {
      test('handles short VPC name', () => {
        const vpc = createMockVpc(stack, { vpcName: 'V' });

        expect(vpc).toBeDefined();
      });

      test('handles long VPC name', () => {
        const longName = 'VeryLongVpcNameForTesting';
        const vpc = createMockVpc(stack, { vpcName: longName });

        expect(vpc).toBeDefined();
      });
    });
  });

  describe('Combined boundary conditions', () => {
    test('handles minimum configuration (1 AZ, 1 subnet type, smallest CIDR)', () => {
      Object.defineProperty(stack, 'availabilityZones', {
        value: ['us-east-1a'],
        writable: false,
      });

      const vpc = new VpcIpV6(stack, 'Vpc', {
        subnetConfiguration: [
          {
            name: 'Single',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 28,
          },
        ],
        availabilityZones: ['us-east-1a'],
      });

      expect(vpc).toBeDefined();
    });

    test('handles maximum configuration (6 AZs, 3 subnet types, various CIDRs)', () => {
      const manyAzs = ['us-east-1a', 'us-east-1b', 'us-east-1c', 'us-east-1d', 'us-east-1e', 'us-east-1f'];
      Object.defineProperty(stack, 'availabilityZones', {
        value: manyAzs,
        writable: false,
      });

      const vpc = new VpcIpV6(stack, 'Vpc', {
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
            subnetIpConfiguration: IPAddressType.DualStack,
          },
          {
            name: 'Isolated',
            subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            cidrMask: 24,
            subnetIpConfiguration: IPAddressType.IPv6,
          },
        ],
        availabilityZones: manyAzs,
      });

      expect(vpc).toBeDefined();
      expect(vpc.ipV6Enabled).toBe(true);
    });

    test('handles network builder with maximum capacity utilization', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      const subnets = builder.addSubnets(24, 256);

      expect(subnets).toHaveLength(256);
      expect(builder.getCidrs()).toHaveLength(256);
      expect(() => builder.addSubnet(28)).toThrow('exceeds remaining space');
    });

    test('handles network builder with mixed subnet sizes at boundaries', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      builder.addSubnet(16); // Uses entire space

      expect(() => builder.addSubnet(28)).toThrow('exceeds remaining space');
    });
  });
});
