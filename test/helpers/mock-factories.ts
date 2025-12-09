/**
 * Mock factory functions for creating test AWS resources
 * Provides reusable mocks for common CDK constructs
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/**
 * Options for creating a mock VPC
 */
export interface MockVpcOptions {
  /** CIDR block for the VPC (default: 10.0.0.0/16) */
  cidr?: string;
  /** Number of availability zones (default: 3) */
  azCount?: number;
  /** Enable IPv6 support (default: false) */
  enableIpv6?: boolean;
  /** VPC name (default: MockVpc) */
  vpcName?: string;
}

/**
 * Options for creating a mock subnet
 */
export interface MockSubnetOptions {
  /** Availability zone for the subnet */
  availabilityZone?: string;
  /** Subnet type (default: PRIVATE_WITH_EGRESS) */
  subnetType?: ec2.SubnetType;
  /** Enable IPv6 (default: false) */
  ipv6?: boolean;
  /** CIDR block for the subnet */
  cidrBlock?: string;
}

/**
 * Options for creating a mock load balancer
 */
export interface MockLoadBalancerOptions {
  /** Load balancer type */
  type: 'application' | 'network';
  /** Subnets for the load balancer */
  subnets?: ec2.ISubnet[];
  /** VPC for the load balancer */
  vpc?: ec2.IVpc;
  /** Internet facing (default: true) */
  internetFacing?: boolean;
  /** Load balancer name */
  loadBalancerName?: string;
}

/**
 * Creates a mock VPC with configurable options
 */
export function createMockVpc(
  scope: Construct,
  options: MockVpcOptions = {},
): ec2.Vpc {
  const {
    cidr = '10.0.0.0/16',
    azCount = 3,
    vpcName = 'MockVpc',
  } = options;

  return new ec2.Vpc(scope, vpcName, {
    ipAddresses: ec2.IpAddresses.cidr(cidr),
    maxAzs: azCount,
    natGateways: 1,
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
  });
}

/**
 * Creates a mock subnet with configurable options
 */
export function createMockSubnet(
  scope: Construct,
  vpc: ec2.IVpc,
  options: MockSubnetOptions = {},
): ec2.Subnet {
  const {
    availabilityZone = 'us-east-1a',
    cidrBlock = '10.0.1.0/24',
  } = options;

  return new ec2.Subnet(scope, 'MockSubnet', {
    vpcId: vpc.vpcId,
    availabilityZone,
    cidrBlock,
  });
}

/**
 * Creates a mock application or network load balancer
 */
export function createMockLoadBalancer(
  scope: Construct,
  options: MockLoadBalancerOptions,
): elbv2.ILoadBalancerV2 {
  const {
    type,
    vpc,
    subnets,
    internetFacing = true,
    loadBalancerName = 'MockLoadBalancer',
  } = options;

  if (!vpc && !subnets) {
    throw new Error('Either vpc or subnets must be provided');
  }

  const vpcSubnets = subnets
    ? { subnets }
    : { subnetType: ec2.SubnetType.PUBLIC };

  if (type === 'application') {
    return new elbv2.ApplicationLoadBalancer(scope, loadBalancerName, {
      vpc: vpc!,
      internetFacing,
      vpcSubnets,
    });
  } else {
    return new elbv2.NetworkLoadBalancer(scope, loadBalancerName, {
      vpc: vpc!,
      internetFacing,
      vpcSubnets,
    });
  }
}

/**
 * Creates a mock security group
 */
export function createMockSecurityGroup(
  scope: Construct,
  vpc: ec2.IVpc,
  name: string = 'MockSecurityGroup',
): ec2.SecurityGroup {
  return new ec2.SecurityGroup(scope, name, {
    vpc,
    description: 'Mock security group for testing',
    allowAllOutbound: true,
  });
}

/**
 * Creates a mock CloudWatch log group
 */
export function createMockLogGroup(
  scope: Construct,
  name: string = 'MockLogGroup',
): logs.LogGroup {
  return new logs.LogGroup(scope, name, {
    logGroupName: `/aws/test/${name}`,
    retention: logs.RetentionDays.ONE_WEEK,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
  });
}

/**
 * Creates multiple mock subnets across availability zones
 */
export function createMockSubnets(
  scope: Construct,
  vpc: ec2.IVpc,
  count: number = 3,
): ec2.ISubnet[] {
  const azs = ['us-east-1a', 'us-east-1b', 'us-east-1c'];
  const subnets: ec2.ISubnet[] = [];

  for (let i = 0; i < count; i++) {
    const subnet = new ec2.Subnet(scope, `MockSubnet${i}`, {
      vpcId: vpc.vpcId,
      availabilityZone: azs[i % azs.length],
      cidrBlock: `10.0.${i + 1}.0/24`,
    });
    subnets.push(subnet);
  }

  return subnets;
}

/**
 * Creates a mock Lambda function for ECR uploader
 */
export function createMockUploaderFunction(
  scope: Construct,
  name: string = 'MockUploaderFunction',
): lambda.Function {
  return new lambda.Function(scope, name, {
    runtime: lambda.Runtime.PYTHON_3_12,
    handler: 'index.handler',
    code: lambda.Code.fromInline('def handler(event, context): return {"statusCode": 200}'),
    timeout: cdk.Duration.seconds(300),
    memorySize: 512,
  });
}
