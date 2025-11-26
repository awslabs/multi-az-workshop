// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import { Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import {
  EnhancedNetworkLoadBalancer,
  EnhancedApplicationLoadBalancer,
} from '../../../src/cdk/lib/constructs/enhanced-load-balancer';
import { createMockVpc } from '../../helpers/mock-factories';
import { synthesizeStack, getResourceCount } from '../../helpers/stack-helpers';
import { createTestApp } from '../../helpers/test-fixtures';

describe('EnhancedNetworkLoadBalancer', () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpc: ec2.Vpc;

  beforeEach(() => {
    app = createTestApp();
    stack = new cdk.Stack(app, 'TestStack');
    vpc = createMockVpc(stack, { azCount: 3 });
  });

  describe('constructor', () => {
    test('creates network load balancer with required properties', () => {
      const nlb = new EnhancedNetworkLoadBalancer(stack, 'NLB', {
        vpc,
        internetFacing: true,
      });

      expect(nlb).toBeDefined();
      expect(nlb.loadBalancerName).toBeDefined();
      expect(nlb.loadBalancerArn).toBeDefined();
      expect(nlb.loadBalancerFullName).toBeDefined();
    });

    test('creates internal network load balancer', () => {
      new EnhancedNetworkLoadBalancer(stack, 'NLB', {
        vpc,
        internetFacing: false,
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
        Type: 'network',
        Scheme: 'internal',
      });
    });

    test('creates internet-facing network load balancer', () => {
      new EnhancedNetworkLoadBalancer(stack, 'NLB', {
        vpc,
        internetFacing: true,
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
        Type: 'network',
        Scheme: 'internet-facing',
      });
    });
  });

  describe('subnets and availability zones', () => {
    test('exposes subnets from VPC selection', () => {
      const nlb = new EnhancedNetworkLoadBalancer(stack, 'NLB', {
        vpc,
        internetFacing: true,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      });

      expect(nlb.subnets).toBeDefined();
      expect(nlb.subnets.length).toBeGreaterThan(0);
      expect(Array.isArray(nlb.subnets)).toBe(true);
    });

    test('exposes availability zones from subnets', () => {
      const nlb = new EnhancedNetworkLoadBalancer(stack, 'NLB', {
        vpc,
        internetFacing: true,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      });

      expect(nlb.availabilityZones).toBeDefined();
      expect(nlb.availabilityZones.length).toBeGreaterThan(0);
      expect(Array.isArray(nlb.availabilityZones)).toBe(true);
    });

    test('availability zones match subnet count', () => {
      const nlb = new EnhancedNetworkLoadBalancer(stack, 'NLB', {
        vpc,
        internetFacing: true,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      });

      expect(nlb.availabilityZones.length).toBe(nlb.subnets.length);
    });

    test('availability zones are extracted from subnets', () => {
      const nlb = new EnhancedNetworkLoadBalancer(stack, 'NLB', {
        vpc,
        internetFacing: true,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      });

      nlb.subnets.forEach((subnet, index) => {
        expect(nlb.availabilityZones[index]).toBe(subnet.availabilityZone);
      });
    });
  });

  describe('CloudFormation resources', () => {
    test('creates load balancer resource', () => {
      new EnhancedNetworkLoadBalancer(stack, 'NLB', {
        vpc,
        internetFacing: true,
      });

      const template = synthesizeStack(stack);
      const count = getResourceCount(template, 'AWS::ElasticLoadBalancingV2::LoadBalancer');
      expect(count).toBe(1);
    });

    test('sets correct load balancer type', () => {
      new EnhancedNetworkLoadBalancer(stack, 'NLB', {
        vpc,
        internetFacing: true,
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
        Type: 'network',
      });
    });

    test('configures subnets in CloudFormation', () => {
      new EnhancedNetworkLoadBalancer(stack, 'NLB', {
        vpc,
        internetFacing: true,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
        Subnets: Match.anyValue(),
      });
    });
  });
});

describe('EnhancedApplicationLoadBalancer', () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpc: ec2.Vpc;

  beforeEach(() => {
    app = createTestApp();
    stack = new cdk.Stack(app, 'TestStack');
    vpc = createMockVpc(stack, { azCount: 3 });
  });

  describe('constructor', () => {
    test('creates application load balancer with required properties', () => {
      const alb = new EnhancedApplicationLoadBalancer(stack, 'ALB', {
        vpc,
        internetFacing: true,
      });

      expect(alb).toBeDefined();
      expect(alb.loadBalancerName).toBeDefined();
      expect(alb.loadBalancerArn).toBeDefined();
      expect(alb.loadBalancerFullName).toBeDefined();
    });

    test('creates internal application load balancer', () => {
      new EnhancedApplicationLoadBalancer(stack, 'ALB', {
        vpc,
        internetFacing: false,
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
        Type: 'application',
        Scheme: 'internal',
      });
    });

    test('creates internet-facing application load balancer', () => {
      new EnhancedApplicationLoadBalancer(stack, 'ALB', {
        vpc,
        internetFacing: true,
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
        Type: 'application',
        Scheme: 'internet-facing',
      });
    });
  });

  describe('subnets and availability zones', () => {
    test('exposes subnets from VPC selection', () => {
      const alb = new EnhancedApplicationLoadBalancer(stack, 'ALB', {
        vpc,
        internetFacing: true,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      });

      expect(alb.subnets).toBeDefined();
      expect(alb.subnets.length).toBeGreaterThan(0);
      expect(Array.isArray(alb.subnets)).toBe(true);
    });

    test('exposes availability zones from subnets', () => {
      const alb = new EnhancedApplicationLoadBalancer(stack, 'ALB', {
        vpc,
        internetFacing: true,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      });

      expect(alb.availabilityZones).toBeDefined();
      expect(alb.availabilityZones.length).toBeGreaterThan(0);
      expect(Array.isArray(alb.availabilityZones)).toBe(true);
    });

    test('availability zones match subnet count', () => {
      const alb = new EnhancedApplicationLoadBalancer(stack, 'ALB', {
        vpc,
        internetFacing: true,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      });

      expect(alb.availabilityZones.length).toBe(alb.subnets.length);
    });

    test('availability zones are extracted from subnets', () => {
      const alb = new EnhancedApplicationLoadBalancer(stack, 'ALB', {
        vpc,
        internetFacing: true,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      });

      alb.subnets.forEach((subnet, index) => {
        expect(alb.availabilityZones[index]).toBe(subnet.availabilityZone);
      });
    });
  });

  describe('CloudFormation resources', () => {
    test('creates load balancer resource', () => {
      new EnhancedApplicationLoadBalancer(stack, 'ALB', {
        vpc,
        internetFacing: true,
      });

      const template = synthesizeStack(stack);
      const count = getResourceCount(template, 'AWS::ElasticLoadBalancingV2::LoadBalancer');
      expect(count).toBe(1);
    });

    test('sets correct load balancer type', () => {
      new EnhancedApplicationLoadBalancer(stack, 'ALB', {
        vpc,
        internetFacing: true,
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
        Type: 'application',
      });
    });

    test('configures subnets in CloudFormation', () => {
      new EnhancedApplicationLoadBalancer(stack, 'ALB', {
        vpc,
        internetFacing: true,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
        Subnets: Match.anyValue(),
      });
    });
  });

  describe('public interface', () => {
    test('implements IEnhancedLoadBalancerV2 interface', () => {
      const alb = new EnhancedApplicationLoadBalancer(stack, 'ALB', {
        vpc,
        internetFacing: true,
      });

      expect(alb.subnets).toBeDefined();
      expect(alb.availabilityZones).toBeDefined();
      expect(alb.loadBalancerName).toBeDefined();
      expect(alb.loadBalancerFullName).toBeDefined();
      expect(alb.loadBalancerArn).toBeDefined();
    });

    test('implements IApplicationLoadBalancer interface', () => {
      const alb = new EnhancedApplicationLoadBalancer(stack, 'ALB', {
        vpc,
        internetFacing: true,
      });

      expect(typeof alb.addListener).toBe('function');
      expect(alb.loadBalancerArn).toBeDefined();
    });
  });

  describe('edge cases - optional properties', () => {
    test('creates ALB with minimal required properties', () => {
      const alb = new EnhancedApplicationLoadBalancer(stack, 'ALB', {
        vpc,
        internetFacing: true,
      });

      expect(alb).toBeDefined();
      expect(alb.subnets.length).toBeGreaterThan(0);
    });

    test('creates ALB with all optional properties omitted', () => {
      const alb = new EnhancedApplicationLoadBalancer(stack, 'ALB', {
        vpc,
        internetFacing: false,
      });

      expect(alb).toBeDefined();
      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
        Type: 'application',
        Scheme: 'internal',
      });
    });

    test('creates ALB with custom load balancer name', () => {
      new EnhancedApplicationLoadBalancer(stack, 'ALB', {
        vpc,
        internetFacing: true,
        loadBalancerName: 'custom-alb-name',
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
        Name: 'custom-alb-name',
      });
    });

    test('creates ALB with specific subnet selection', () => {
      const alb = new EnhancedApplicationLoadBalancer(stack, 'ALB', {
        vpc,
        internetFacing: true,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      });

      expect(alb.subnets).toBeDefined();
      expect(alb.subnets.length).toBeGreaterThan(0);
    });

    test('handles VPC with single availability zone', () => {
      const singleAzVpc = createMockVpc(stack, { azCount: 1, vpcName: 'SingleAzVpc' });
      const alb = new EnhancedApplicationLoadBalancer(stack, 'ALB', {
        vpc: singleAzVpc,
        internetFacing: true,
      });

      expect(alb.availabilityZones.length).toBe(1);
      expect(alb.subnets.length).toBe(1);
    });

    test('handles VPC with maximum availability zones', () => {
      const multiAzVpc = createMockVpc(stack, { azCount: 6, vpcName: 'MultiAzVpc' });
      const alb = new EnhancedApplicationLoadBalancer(stack, 'ALB', {
        vpc: multiAzVpc,
        internetFacing: true,
      });

      expect(alb.availabilityZones.length).toBeGreaterThanOrEqual(2);
      expect(alb.subnets.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('edge cases - NLB optional properties', () => {
    test('creates NLB with minimal required properties', () => {
      const nlb = new EnhancedNetworkLoadBalancer(stack, 'NLB', {
        vpc,
        internetFacing: true,
      });

      expect(nlb).toBeDefined();
      expect(nlb.subnets.length).toBeGreaterThan(0);
    });

    test('creates NLB with cross-zone load balancing disabled', () => {
      const nlb = new EnhancedNetworkLoadBalancer(stack, 'NLB', {
        vpc,
        internetFacing: true,
        crossZoneEnabled: false,
      });

      expect(nlb).toBeDefined();
      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
        Type: 'network',
      });
    });
  });
});
