/**
 * Test fixtures for creating pre-configured test data and scenarios
 * Provides reusable test stacks and common test data
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

/**
 * Common test data constants
 */
export const TEST_AVAILABILITY_ZONES = ['us-east-1a', 'us-east-1b', 'us-east-1c'];
export const TEST_VPC_CIDR = '10.0.0.0/16';
export const TEST_REGION = 'us-east-1';
export const TEST_ACCOUNT = '123456789012';

/**
 * Options for creating a test stack
 */
export interface TestStackProps extends cdk.StackProps {
  /** Availability zones to use (default: TEST_AVAILABILITY_ZONES) */
  availabilityZones?: string[];
  /** Enable IPv6 support (default: false) */
  enableIpv6?: boolean;
  /** Create a VPC automatically (default: false) */
  createVpc?: boolean;
  /** VPC CIDR if creating VPC (default: TEST_VPC_CIDR) */
  vpcCidr?: string;
  /** Number of AZs if creating VPC (default: 3) */
  azCount?: number;
}

/**
 * Test stack with common configuration and optional VPC
 */
export class TestStack extends cdk.Stack {
  public readonly vpc?: ec2.Vpc;
  public readonly subnets?: ec2.ISubnet[];

  constructor(scope: Construct, id: string, props: TestStackProps = {}) {
    const {
      availabilityZones = TEST_AVAILABILITY_ZONES,
      createVpc = false,
      vpcCidr = TEST_VPC_CIDR,
      azCount = 3,
      ...stackProps
    } = props;

    super(scope, id, {
      env: {
        account: TEST_ACCOUNT,
        region: TEST_REGION,
      },
      ...stackProps,
    });

    // Override availability zones for testing
    Object.defineProperty(this, 'availabilityZones', {
      value: availabilityZones,
      writable: false,
    });

    if (createVpc) {
      this.vpc = new ec2.Vpc(this, 'TestVpc', {
        ipAddresses: ec2.IpAddresses.cidr(vpcCidr),
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
        ],
      });

      this.subnets = this.vpc.privateSubnets;
    }
  }
}

/**
 * Creates a test app with standard configuration
 */
export function createTestApp(): cdk.App {
  return new cdk.App({
    context: {
      '@aws-cdk/core:newStyleStackSynthesis': true,
    },
  });
}

/**
 * Creates a test stack with standard configuration
 */
export function createTestStack(
  app?: cdk.App,
  props?: TestStackProps,
): TestStack {
  const testApp = app || createTestApp();
  return new TestStack(testApp, 'TestStack', props);
}

/**
 * Creates a minimal CDK stack for testing
 */
export function createMinimalStack(
  app?: cdk.App,
  id: string = 'MinimalStack',
): cdk.Stack {
  const testApp = app || createTestApp();
  return new cdk.Stack(testApp, id, {
    env: {
      account: TEST_ACCOUNT,
      region: TEST_REGION,
    },
  });
}

/**
 * Creates a test stack with VPC pre-configured
 */
export function createStackWithVpc(
  app?: cdk.App,
  vpcCidr: string = TEST_VPC_CIDR,
): { stack: TestStack; vpc: ec2.Vpc } {
  const stack = createTestStack(app, {
    createVpc: true,
    vpcCidr,
  });

  if (!stack.vpc) {
    throw new Error('VPC was not created');
  }

  return { stack, vpc: stack.vpc };
}

/**
 * Common test environment configuration
 */
export const TEST_ENV = {
  account: TEST_ACCOUNT,
  region: TEST_REGION,
};

/**
 * Common subnet configurations for testing
 */
export const TEST_SUBNET_CONFIGS = {
  public: {
    name: 'Public',
    subnetType: ec2.SubnetType.PUBLIC,
    cidrMask: 24,
  },
  private: {
    name: 'Private',
    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    cidrMask: 24,
  },
  isolated: {
    name: 'Isolated',
    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
    cidrMask: 24,
  },
};
