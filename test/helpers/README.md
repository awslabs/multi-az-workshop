# Test Helpers Documentation

This directory contains reusable test utilities for the Multi-AZ Workshop CDK project.

## Overview

The test helpers provide a comprehensive testing infrastructure including:
- Mock factories for AWS resources
- Test fixtures for common scenarios
- Stack helper functions for synthesis and inspection
- Assertion helpers for common test patterns

## Usage

### Importing Helpers

```typescript
import {
  // Mock factories
  createMockVpc,
  createMockLoadBalancer,
  createMockSecurityGroup,
  createMockLogGroup,
  createMockSubnets,
  
  // Test fixtures
  createTestApp,
  createTestStack,
  createMinimalStack,
  createStackWithVpc,
  TEST_AVAILABILITY_ZONES,
  TEST_VPC_CIDR,
  TEST_REGION,
  TEST_ACCOUNT,
  
  // Stack helpers
  synthesizeStack,
  getResourceCount,
  findResourcesByType,
  getResourceTypes,
  hasOutput,
  hasParameter,
  
  // Assertion helpers
  assertResourceExists,
  assertResourceProperties,
  assertResourceCount,
  assertResourceDoesNotExist,
} from './helpers';
```

## Mock Factories

### createMockVpc

Creates a mock VPC with configurable options.

```typescript
const vpc = createMockVpc(stack, {
  cidr: '10.0.0.0/16',
  azCount: 3,
  vpcName: 'TestVpc',
});
```

### createMockLoadBalancer

Creates a mock Application or Network Load Balancer.

```typescript
const alb = createMockLoadBalancer(stack, {
  type: 'application',
  vpc,
  internetFacing: true,
});
```

### createMockSecurityGroup

Creates a mock security group.

```typescript
const sg = createMockSecurityGroup(stack, vpc, 'TestSecurityGroup');
```

### createMockLogGroup

Creates a mock CloudWatch log group.

```typescript
const logGroup = createMockLogGroup(stack, 'TestLogGroup');
```

### createMockSubnets

Creates multiple mock subnets across availability zones.

```typescript
const subnets = createMockSubnets(stack, vpc, 3);
```

## Test Fixtures

### createTestApp

Creates a CDK app with standard test configuration.

```typescript
const app = createTestApp();
```

### createTestStack

Creates a test stack with standard configuration.

```typescript
const stack = createTestStack(app, {
  availabilityZones: ['us-east-1a', 'us-east-1b'],
  createVpc: true,
});
```

### createMinimalStack

Creates a minimal CDK stack for simple tests.

```typescript
const stack = createMinimalStack();
```

### createStackWithVpc

Creates a test stack with a VPC pre-configured.

```typescript
const { stack, vpc } = createStackWithVpc();
```

## Stack Helpers

### synthesizeStack

Synthesizes a stack and returns the CloudFormation template.

```typescript
const template = synthesizeStack(stack);
```

### getResourceCount

Gets the count of resources of a specific type.

```typescript
const count = getResourceCount(template, 'AWS::EC2::VPC');
```

### findResourcesByType

Finds all resources of a specific type.

```typescript
const vpcs = findResourcesByType(template, 'AWS::EC2::VPC');
```

### getResourceTypes

Gets all resource types present in a template.

```typescript
const types = getResourceTypes(template);
```

## Assertion Helpers

### assertResourceExists

Asserts that a resource of a specific type exists.

```typescript
assertResourceExists(template, 'AWS::EC2::VPC', 1);
```

### assertResourceProperties

Asserts that a resource with specific properties exists.

```typescript
assertResourceProperties(template, 'AWS::EC2::VPC', {
  CidrBlock: '10.0.0.0/16',
});
```

### assertResourceCount

Asserts that exactly N resources of a type exist.

```typescript
assertResourceCount(template, 'AWS::EC2::Subnet', 6);
```

### assertResourceDoesNotExist

Asserts that a resource does not exist.

```typescript
assertResourceDoesNotExist(template, 'AWS::EC2::NatGateway');
```

## Example Test

```typescript
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import {
  createTestStack,
  createMockVpc,
  synthesizeStack,
  assertResourceExists,
  assertResourceProperties,
} from '../helpers';

describe('MyConstruct', () => {
  let stack: cdk.Stack;

  beforeEach(() => {
    stack = createTestStack();
  });

  test('creates a VPC', () => {
    const vpc = createMockVpc(stack);
    const template = synthesizeStack(stack);

    assertResourceExists(template, 'AWS::EC2::VPC', 1);
    assertResourceProperties(template, 'AWS::EC2::VPC', {
      CidrBlock: '10.0.0.0/16',
    });
  });
});
```

## Running Tests

Run all tests:
```bash
npm test
```

Run specific test file:
```bash
npm test -- path/to/test.test.ts
```

Run tests without coverage:
```bash
npm test -- --no-coverage
```

Run tests in watch mode:
```bash
npm run test:watch
```

## Coverage Requirements

The project enforces 100% code coverage for all modules:
- Branches: 100%
- Functions: 100%
- Lines: 100%
- Statements: 100%

Coverage reports are generated in the `coverage/` directory.
