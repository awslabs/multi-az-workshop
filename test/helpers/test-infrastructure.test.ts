/**
 * Test infrastructure verification
 * Validates that all test helpers are working correctly
 */

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import {
  assertResourceExists,
  assertResourceProperties,
  assertResourceCount,
  assertResourceDoesNotExist,
} from './assertion-helpers';
import {
  createMockVpc,
  createMockLoadBalancer,
  createMockSecurityGroup,
  createMockLogGroup,
  createMockSubnets,
} from './mock-factories';
import {
  synthesizeStack,
  getResourceCount,
  findResourcesByType,
  findResourceByType,
  getResourceTypes,
  hasOutput,
  hasParameter,
  hasResourceWithProperties,
  getResourceProperties,
  getAllResources,
  getOutputValue,
  getParameterValue,
  countResourcesWithProperties,
} from './stack-helpers';
import {
  createTestApp,
  createTestStack,
  createMinimalStack,
  createStackWithVpc,
  TEST_AVAILABILITY_ZONES,
  TEST_VPC_CIDR,
  TEST_REGION,
  TEST_ACCOUNT,
} from './test-fixtures';

describe('Test Infrastructure', () => {
  describe('Mock Factories', () => {
    let app: cdk.App;
    let stack: cdk.Stack;

    beforeEach(() => {
      app = new cdk.App();
      stack = new cdk.Stack(app, 'TestStack');
    });

    test('createMockVpc creates a VPC', () => {
      const vpc = createMockVpc(stack);

      expect(vpc).toBeDefined();
      expect(vpc.vpcId).toBeDefined();

      const template = Template.fromStack(stack);
      assertResourceExists(template, 'AWS::EC2::VPC', 1);
    });

    test('createMockVpc with custom options', () => {
      const vpc = createMockVpc(stack, {
        cidr: '172.16.0.0/16',
        azCount: 2,
        vpcName: 'CustomVpc',
      });

      expect(vpc).toBeDefined();

      const template = Template.fromStack(stack);
      assertResourceProperties(template, 'AWS::EC2::VPC', {
        CidrBlock: '172.16.0.0/16',
      });
    });

    test('createMockLoadBalancer creates an ALB', () => {
      const vpc = createMockVpc(stack);
      const alb = createMockLoadBalancer(stack, {
        type: 'application',
        vpc,
      });

      expect(alb).toBeDefined();

      const template = Template.fromStack(stack);
      assertResourceExists(template, 'AWS::ElasticLoadBalancingV2::LoadBalancer');
      assertResourceProperties(template, 'AWS::ElasticLoadBalancingV2::LoadBalancer', {
        Type: 'application',
      });
    });

    test('createMockLoadBalancer creates an NLB', () => {
      const vpc = createMockVpc(stack);
      const nlb = createMockLoadBalancer(stack, {
        type: 'network',
        vpc,
      });

      expect(nlb).toBeDefined();

      const template = Template.fromStack(stack);
      assertResourceProperties(template, 'AWS::ElasticLoadBalancingV2::LoadBalancer', {
        Type: 'network',
      });
    });

    test('createMockSecurityGroup creates a security group', () => {
      const vpc = createMockVpc(stack);
      const sg = createMockSecurityGroup(stack, vpc);

      expect(sg).toBeDefined();
      expect(sg.securityGroupId).toBeDefined();

      const template = Template.fromStack(stack);
      assertResourceExists(template, 'AWS::EC2::SecurityGroup');
    });

    test('createMockLogGroup creates a log group', () => {
      const logGroup = createMockLogGroup(stack);

      expect(logGroup).toBeDefined();
      expect(logGroup.logGroupName).toBeDefined();

      const template = Template.fromStack(stack);
      assertResourceExists(template, 'AWS::Logs::LogGroup');
    });

    test('createMockSubnets creates multiple subnets', () => {
      const vpc = createMockVpc(stack);
      const subnets = createMockSubnets(stack, vpc, 3);

      expect(subnets).toHaveLength(3);
      subnets.forEach((subnet) => {
        expect(subnet).toBeDefined();
      });
    });
  });

  describe('Test Fixtures', () => {
    test('createTestApp creates an app', () => {
      const app = createTestApp();

      expect(app).toBeDefined();
      expect(app).toBeInstanceOf(cdk.App);
    });

    test('createTestStack creates a stack', () => {
      const stack = createTestStack();

      expect(stack).toBeDefined();
      expect(stack).toBeInstanceOf(cdk.Stack);
      expect(stack.availabilityZones).toEqual(TEST_AVAILABILITY_ZONES);
    });

    test('createMinimalStack creates a minimal stack', () => {
      const stack = createMinimalStack();

      expect(stack).toBeDefined();
      expect(stack).toBeInstanceOf(cdk.Stack);
    });

    test('createStackWithVpc creates a stack with VPC', () => {
      const { stack, vpc } = createStackWithVpc();

      expect(stack).toBeDefined();
      expect(vpc).toBeDefined();
      expect(vpc).toBeInstanceOf(ec2.Vpc);
    });

    test('TEST_AVAILABILITY_ZONES is defined', () => {
      expect(TEST_AVAILABILITY_ZONES).toBeDefined();
      expect(TEST_AVAILABILITY_ZONES).toHaveLength(3);
    });

    test('TEST_VPC_CIDR is defined', () => {
      expect(TEST_VPC_CIDR).toBe('10.0.0.0/16');
    });

    test('TEST_REGION is defined', () => {
      expect(TEST_REGION).toBe('us-east-1');
    });

    test('TEST_ACCOUNT is defined', () => {
      expect(TEST_ACCOUNT).toBe('123456789012');
    });
  });

  describe('Stack Helpers', () => {
    let app: cdk.App;
    let stack: cdk.Stack;

    beforeEach(() => {
      app = new cdk.App();
      stack = new cdk.Stack(app, 'TestStack');
    });

    test('synthesizeStack returns a template', () => {
      const template = synthesizeStack(stack);

      expect(template).toBeDefined();
    });

    test('getResourceCount returns correct count', () => {
      createMockVpc(stack);

      const template = synthesizeStack(stack);
      const count = getResourceCount(template, 'AWS::EC2::VPC');

      expect(count).toBe(1);
    });

    test('findResourcesByType returns resources', () => {
      createMockVpc(stack);

      const template = synthesizeStack(stack);
      const resources = findResourcesByType(template, 'AWS::EC2::VPC');

      expect(resources).toHaveLength(1);
      expect(resources[0].Type).toBe('AWS::EC2::VPC');
    });

    test('getResourceTypes returns all types', () => {
      createMockVpc(stack);

      const template = synthesizeStack(stack);
      const types = getResourceTypes(template);

      expect(types).toContain('AWS::EC2::VPC');
    });

    test('hasOutput returns false when no outputs', () => {
      const template = synthesizeStack(stack);
      const result = hasOutput(template, 'NonExistent');

      expect(result).toBe(false);
    });

    test('hasParameter returns false when no parameters', () => {
      const template = synthesizeStack(stack);
      const result = hasParameter(template, 'NonExistent');

      expect(result).toBe(false);
    });
  });

  describe('Assertion Helpers', () => {
    let app: cdk.App;
    let stack: cdk.Stack;

    beforeEach(() => {
      app = new cdk.App();
      stack = new cdk.Stack(app, 'TestStack');
    });

    test('assertResourceExists passes when resource exists', () => {
      createMockVpc(stack);

      const template = synthesizeStack(stack);

      expect(() => {
        assertResourceExists(template, 'AWS::EC2::VPC');
      }).not.toThrow();
    });

    test('assertResourceExists throws when resource does not exist', () => {
      const template = synthesizeStack(stack);

      expect(() => {
        assertResourceExists(template, 'AWS::EC2::VPC');
      }).toThrow();
    });

    test('assertResourceCount passes with correct count', () => {
      createMockVpc(stack);

      const template = synthesizeStack(stack);

      expect(() => {
        assertResourceCount(template, 'AWS::EC2::VPC', 1);
      }).not.toThrow();
    });

    test('assertResourceDoesNotExist passes when resource does not exist', () => {
      const template = synthesizeStack(stack);

      expect(() => {
        assertResourceDoesNotExist(template, 'AWS::EC2::VPC');
      }).not.toThrow();
    });

    test('assertResourceProperties passes with matching properties', () => {
      createMockVpc(stack, { cidr: '10.0.0.0/16' });

      const template = synthesizeStack(stack);

      expect(() => {
        assertResourceProperties(template, 'AWS::EC2::VPC', {
          CidrBlock: '10.0.0.0/16',
        });
      }).not.toThrow();
    });
  });

  /**
   * Additional Coverage Tests for Helper Functions
   * Feature: complete-test-coverage, Property 10: Stack Helper Method Reliability
   * Validates: Requirements 4.2
   */
  describe('Property 10: Stack Helper Method Reliability', () => {
    test('findResourceByType returns single resource when exactly one exists', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack');
      createMockLogGroup(stack);

      const template = synthesizeStack(stack);
      const resource = findResourceByType(template, 'AWS::Logs::LogGroup');

      expect(resource).toBeDefined();
      expect(resource.Type).toBe('AWS::Logs::LogGroup');
    });

    test('getAllResources returns empty object for empty stack', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack');
      const template = synthesizeStack(stack);

      const resources = getAllResources(template);

      expect(resources).toEqual({});
    });

    test('countResourcesWithProperties counts matching resources', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack');
      createMockLogGroup(stack, 'Log1');
      createMockLogGroup(stack, 'Log2');

      const template = synthesizeStack(stack);
      const count = countResourcesWithProperties(template, 'AWS::Logs::LogGroup', {
        RetentionInDays: 7,
      });

      expect(count).toBe(2);
    });

    test('hasResourceWithProperties returns true when resource matches', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack');
      createMockLogGroup(stack);

      const template = synthesizeStack(stack);
      const hasResource = hasResourceWithProperties(template, 'AWS::Logs::LogGroup', {
        RetentionInDays: 7,
      });

      expect(hasResource).toBe(true);
    });

    test('hasResourceWithProperties returns false when no match', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack');
      const template = synthesizeStack(stack);

      const hasResource = hasResourceWithProperties(template, 'AWS::Logs::LogGroup', {
        RetentionInDays: 7,
      });

      expect(hasResource).toBe(false);
    });
  });

  /**
   * Additional Coverage Tests for Error Handling
   * Feature: complete-test-coverage, Property 11: Helper Function Error Handling
   * Validates: Requirements 4.4
   */
  describe('Property 11: Helper Function Error Handling', () => {
    test('findResourceByType throws when no resources exist', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack');
      const template = synthesizeStack(stack);

      expect(() => {
        findResourceByType(template, 'AWS::Logs::LogGroup');
      }).toThrow();
    });

    test('findResourceByType throws when multiple resources exist', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack');
      createMockLogGroup(stack, 'Log1');
      createMockLogGroup(stack, 'Log2');

      const template = synthesizeStack(stack);

      expect(() => {
        findResourceByType(template, 'AWS::Logs::LogGroup');
      }).toThrow();
    });

    test('getResourceProperties throws for non-existent logical ID', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack');
      const template = synthesizeStack(stack);

      expect(() => {
        getResourceProperties(template, 'NonExistentResource');
      }).toThrow();
    });

    test('getOutputValue throws for non-existent output', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack');
      const template = synthesizeStack(stack);

      expect(() => {
        getOutputValue(template, 'NonExistentOutput');
      }).toThrow();
    });

    test('getParameterValue throws for non-existent parameter', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack');
      const template = synthesizeStack(stack);

      expect(() => {
        getParameterValue(template, 'NonExistentParam');
      }).toThrow();
    });
  });

  /**
   * Additional Coverage Tests for Resource Type Handling
   * Feature: complete-test-coverage, Property 12: Resource Type Handling in Helpers
   * Validates: Requirements 4.5
   */
  describe('Property 12: Resource Type Handling in Helpers', () => {
    test('getResourceProperties returns properties for valid logical ID', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack');
      createMockLogGroup(stack, 'TestLog');

      const template = synthesizeStack(stack);
      const resources = findResourcesByType(template, 'AWS::Logs::LogGroup');
      const logicalId = resources[0].logicalId;

      const properties = getResourceProperties(template, logicalId);

      expect(properties).toBeDefined();
      expect(properties.RetentionInDays).toBe(7);
    });

    test('getOutputValue returns value for existing output', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack');

      new cdk.CfnOutput(stack, 'TestOutput', {
        value: 'test-value',
      });

      const template = synthesizeStack(stack);
      const value = getOutputValue(template, 'TestOutput');

      expect(value).toBe('test-value');
    });

    test('getParameterValue returns parameter for existing parameter', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack');

      new cdk.CfnParameter(stack, 'TestParam', {
        type: 'String',
        default: 'default-value',
      });

      const template = synthesizeStack(stack);
      const param = getParameterValue(template, 'TestParam');

      expect(param).toBeDefined();
      expect(param.Type).toBe('String');
      expect(param.Default).toBe('default-value');
    });
  });
});
