// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import {
  createMockVpc,
  createMockLoadBalancer,
  createMockSubnet,
  createMockSecurityGroup,
  createMockLogGroup,
  createMockSubnets,
} from './mock-factories';
import { createTestApp } from './test-fixtures';

describe('Mock Factories Validation', () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = createTestApp();
    stack = new cdk.Stack(app, 'TestStack');
  });

  describe('createMockLoadBalancer validation', () => {
    test('throws error when neither vpc nor subnets provided', () => {
      expect(() =>
        createMockLoadBalancer(stack, {
          type: 'application',
        } as any),
      ).toThrow('Either vpc or subnets must be provided');
    });

    test('accepts vpc without subnets', () => {
      const vpc = createMockVpc(stack);

      expect(() =>
        createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        }),
      ).not.toThrow();
    });

    test('accepts subnets without vpc', () => {
      const vpc = createMockVpc(stack);
      const subnets = createMockSubnets(stack, vpc, 2);

      expect(() =>
        createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
          subnets,
        }),
      ).not.toThrow();
    });
  });

  describe('createMockVpc edge cases', () => {
    test('creates VPC with minimum AZ count (1)', () => {
      const vpc = createMockVpc(stack, { azCount: 1 });

      expect(vpc).toBeDefined();
      expect(vpc.availabilityZones.length).toBeGreaterThanOrEqual(1);
    });

    test('creates VPC with maximum AZ count', () => {
      const vpc = createMockVpc(stack, { azCount: 6 });

      expect(vpc).toBeDefined();
      expect(vpc.availabilityZones.length).toBeGreaterThanOrEqual(2);
    });

    test('creates VPC with custom CIDR', () => {
      const vpc = createMockVpc(stack, { cidr: '192.168.0.0/16' });

      expect(vpc).toBeDefined();
      expect(vpc.vpcCidrBlock).toBeDefined();
    });

    test('creates VPC with default values when options omitted', () => {
      const vpc = createMockVpc(stack);

      expect(vpc).toBeDefined();
      expect(vpc.vpcCidrBlock).toBeDefined();
    });
  });

  describe('createMockSubnet edge cases', () => {
    test('creates subnet with default values', () => {
      const vpc = createMockVpc(stack);
      const subnet = createMockSubnet(stack, vpc);

      expect(subnet).toBeDefined();
      expect(subnet.availabilityZone).toBe('us-east-1a');
    });

    test('creates subnet with custom availability zone', () => {
      const vpc = createMockVpc(stack);
      const subnet = createMockSubnet(stack, vpc, {
        availabilityZone: 'us-west-2b',
      });

      expect(subnet.availabilityZone).toBe('us-west-2b');
    });

    test('creates subnet with custom CIDR', () => {
      const vpc = createMockVpc(stack);
      const subnet = createMockSubnet(stack, vpc, {
        cidrBlock: '10.0.100.0/24',
      });

      expect(subnet).toBeDefined();
    });
  });

  describe('createMockSubnets edge cases', () => {
    test('creates zero subnets when count is 0', () => {
      const vpc = createMockVpc(stack);
      const subnets = createMockSubnets(stack, vpc, 0);

      expect(subnets).toHaveLength(0);
    });

    test('creates single subnet when count is 1', () => {
      const vpc = createMockVpc(stack);
      const subnets = createMockSubnets(stack, vpc, 1);

      expect(subnets).toHaveLength(1);
    });

    test('creates multiple subnets with unique CIDRs', () => {
      const vpc = createMockVpc(stack);
      const subnets = createMockSubnets(stack, vpc, 5);

      expect(subnets).toHaveLength(5);
      const cidrs = subnets.map((s) => (s as ec2.Subnet).ipv4CidrBlock);
      const uniqueCidrs = new Set(cidrs);
      expect(uniqueCidrs.size).toBe(5);
    });

    test('creates subnets across different availability zones', () => {
      const vpc = createMockVpc(stack);
      const subnets = createMockSubnets(stack, vpc, 6);

      expect(subnets).toHaveLength(6);
      const azs = subnets.map((s) => s.availabilityZone);
      expect(azs).toContain('us-east-1a');
      expect(azs).toContain('us-east-1b');
      expect(azs).toContain('us-east-1c');
    });
  });

  describe('createMockSecurityGroup edge cases', () => {
    test('creates security group with default name', () => {
      const vpc = createMockVpc(stack);
      const sg = createMockSecurityGroup(stack, vpc);

      expect(sg).toBeDefined();
      expect(sg.securityGroupId).toBeDefined();
    });

    test('creates security group with custom name', () => {
      const vpc = createMockVpc(stack);
      const sg = createMockSecurityGroup(stack, vpc, 'CustomSG');

      expect(sg).toBeDefined();
    });
  });

  describe('createMockLogGroup edge cases', () => {
    test('creates log group with default name', () => {
      const logGroup = createMockLogGroup(stack);

      expect(logGroup).toBeDefined();
      expect(logGroup.logGroupName).toBeDefined();
    });

    test('creates log group with custom name', () => {
      const logGroup = createMockLogGroup(stack, 'CustomLogGroup');

      expect(logGroup).toBeDefined();
      expect(logGroup.logGroupName).toBeDefined();
    });
  });
});
