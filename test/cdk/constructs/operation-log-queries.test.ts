// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { IOperation } from '@cdklabs/multi-az-observability';
import * as cdk from 'aws-cdk-lib';
import { Match } from 'aws-cdk-lib/assertions';
import { OperationLogQueries } from '../../../src/cdk/lib/constructs/operation-log-queries';
import { createMockLogGroup } from '../../helpers/mock-factories';
import { synthesizeStack, getResourceCount, findResourcesByType } from '../../helpers/stack-helpers';
import { createTestApp } from '../../helpers/test-fixtures';

describe('OperationLogQueries', () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let mockOperation: IOperation;

  beforeEach(() => {
    app = createTestApp();
    stack = new cdk.Stack(app, 'TestStack');

    // Create a mock operation with minimal required properties
    mockOperation = {
      operationName: 'TestOperation',
      path: '/test',
      service: {} as any,
      critical: true,
      httpMethods: ['GET'],
      serverSideAvailabilityMetricDetails: {} as any,
      serverSideLatencyMetricDetails: {
        operationName: 'TestOperation',
        successAlarmThreshold: cdk.Duration.millis(1000),
        faultAlarmThreshold: cdk.Duration.millis(10),
        metricNamespace: 'TestNamespace',
        successMetricNames: ['Success'],
        faultMetricNames: ['Fault'],
        metricName: 'Latency',
        alarmStatistic: 'Average',
        datapointsToAlarm: 3,
        evaluationPeriods: 5,
        period: cdk.Duration.seconds(60),
        metricDimensions: {
          staticDimensions: {},
          availabilityZoneIdKey: 'AZ-ID',
          zonalDimensions: [],
          regionalDimensions: [],
        },
        unit: 'Milliseconds',
      },
    } as unknown as IOperation;
  });

  describe('constructor', () => {
    test('creates construct with required properties', () => {
      const logGroup = createMockLogGroup(stack, 'TestLogGroup');

      const queries = new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup],
        operation: mockOperation,
        nameSuffix: '-test',
        availabilityZoneIds: ['use1-az1', 'use1-az2'],
      });

      expect(queries).toBeDefined();
    });

    test('creates construct with multiple log groups', () => {
      const logGroup1 = createMockLogGroup(stack, 'LogGroup1');
      const logGroup2 = createMockLogGroup(stack, 'LogGroup2');

      const queries = new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup1, logGroup2],
        operation: mockOperation,
        nameSuffix: '-test',
        availabilityZoneIds: ['use1-az1'],
      });

      expect(queries).toBeDefined();
    });

    test('creates construct with empty name suffix', () => {
      const logGroup = createMockLogGroup(stack, 'TestLogGroup');

      const queries = new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup],
        operation: mockOperation,
        nameSuffix: '',
        availabilityZoneIds: ['use1-az1'],
      });

      expect(queries).toBeDefined();
    });
  });

  describe('CloudWatch Insights query creation', () => {
    test('creates regional request log query', () => {
      const logGroup = createMockLogGroup(stack, 'TestLogGroup');

      new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup],
        operation: mockOperation,
        nameSuffix: '-test',
        availabilityZoneIds: ['use1-az1'],
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Logs::QueryDefinition', {
        QueryString: Match.stringLikeRegexp('.*RequestId.*SuccessLatency.*'),
      });
    });

    test('creates regional high latency log query', () => {
      const logGroup = createMockLogGroup(stack, 'TestLogGroup');

      new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup],
        operation: mockOperation,
        nameSuffix: '-test',
        availabilityZoneIds: ['use1-az1'],
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Logs::QueryDefinition', {
        QueryString: Match.stringLikeRegexp('.*SuccessLatency >.*'),
      });
    });

    test('creates regional fault log query', () => {
      const logGroup = createMockLogGroup(stack, 'TestLogGroup');

      new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup],
        operation: mockOperation,
        nameSuffix: '-test',
        availabilityZoneIds: ['use1-az1'],
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Logs::QueryDefinition', {
        QueryString: Match.stringLikeRegexp('.*Fault = 1 or Failure = 1.*'),
      });
    });

    test('creates per-AZ request log queries', () => {
      const logGroup = createMockLogGroup(stack, 'TestLogGroup');

      new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup],
        operation: mockOperation,
        nameSuffix: '-test',
        availabilityZoneIds: ['use1-az1', 'use1-az2'],
      });

      const template = synthesizeStack(stack);
      const queries = findResourcesByType(template, 'AWS::Logs::QueryDefinition');

      // Should have 3 regional queries + 3 queries per AZ * 2 AZs = 9 total
      expect(queries.length).toBe(9);
    });

    test('creates per-AZ high latency log queries', () => {
      const logGroup = createMockLogGroup(stack, 'TestLogGroup');

      new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup],
        operation: mockOperation,
        nameSuffix: '-test',
        availabilityZoneIds: ['use1-az1'],
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Logs::QueryDefinition', {
        QueryString: Match.stringLikeRegexp('.*`AZ-ID` = "use1-az1"[\\s\\S]*SuccessLatency >.*'),
      });
    });

    test('creates per-AZ fault log queries', () => {
      const logGroup = createMockLogGroup(stack, 'TestLogGroup');

      new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup],
        operation: mockOperation,
        nameSuffix: '-test',
        availabilityZoneIds: ['use1-az1'],
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Logs::QueryDefinition', {
        QueryString: Match.stringLikeRegexp('.*`AZ-ID` = "use1-az1"[\\s\\S]*Fault = 1 or Failure = 1.*'),
      });
    });
  });

  describe('query configuration for different operations', () => {
    test('uses operation name in query filters', () => {
      const logGroup = createMockLogGroup(stack, 'TestLogGroup');

      new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup],
        operation: mockOperation,
        nameSuffix: '-test',
        availabilityZoneIds: ['use1-az1'],
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Logs::QueryDefinition', {
        QueryString: Match.stringLikeRegexp('.*Operation = "TestOperation".*'),
      });
    });

    test('uses operation latency threshold in queries', () => {
      const logGroup = createMockLogGroup(stack, 'TestLogGroup');
      const customOperation = {
        ...mockOperation,
        serverSideLatencyMetricDetails: {
          ...mockOperation.serverSideLatencyMetricDetails,
          successAlarmThreshold: cdk.Duration.millis(2500),
        },
      } as unknown as IOperation;

      new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup],
        operation: customOperation,
        nameSuffix: '-test',
        availabilityZoneIds: ['use1-az1'],
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Logs::QueryDefinition', {
        QueryString: Match.stringLikeRegexp('.*SuccessLatency >.*'),
      });
    });

    test('includes operation name in query definition names', () => {
      const logGroup = createMockLogGroup(stack, 'TestLogGroup');

      new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup],
        operation: mockOperation,
        nameSuffix: '-test',
        availabilityZoneIds: ['use1-az1'],
      });

      const template = synthesizeStack(stack);
      const queries = findResourcesByType(template, 'AWS::Logs::QueryDefinition');

      expect(queries.length).toBeGreaterThan(0);
    });
  });

  describe('log group integration', () => {
    test('associates queries with log groups', () => {
      const logGroup = createMockLogGroup(stack, 'TestLogGroup');

      new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup],
        operation: mockOperation,
        nameSuffix: '-test',
        availabilityZoneIds: ['use1-az1'],
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Logs::QueryDefinition', {
        LogGroupNames: Match.anyValue(),
      });
    });

    test('supports multiple log groups', () => {
      const logGroup1 = createMockLogGroup(stack, 'LogGroup1');
      const logGroup2 = createMockLogGroup(stack, 'LogGroup2');

      new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup1, logGroup2],
        operation: mockOperation,
        nameSuffix: '-test',
        availabilityZoneIds: ['use1-az1'],
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Logs::QueryDefinition', {
        LogGroupNames: Match.anyValue(),
      });
    });
  });

  describe('query definitions', () => {
    test('queries include required fields', () => {
      const logGroup = createMockLogGroup(stack, 'TestLogGroup');

      new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup],
        operation: mockOperation,
        nameSuffix: '-test',
        availabilityZoneIds: ['use1-az1'],
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Logs::QueryDefinition', {
        QueryString: Match.stringLikeRegexp('.*fields.*RequestId.*SuccessLatency.*`AZ-ID`.*'),
      });
    });

    test('queries include filter statements', () => {
      const logGroup = createMockLogGroup(stack, 'TestLogGroup');

      new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup],
        operation: mockOperation,
        nameSuffix: '-test',
        availabilityZoneIds: ['use1-az1'],
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Logs::QueryDefinition', {
        QueryString: Match.stringLikeRegexp('.*filter.*'),
      });
    });

    test('queries include limit clause', () => {
      const logGroup = createMockLogGroup(stack, 'TestLogGroup');

      new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup],
        operation: mockOperation,
        nameSuffix: '-test',
        availabilityZoneIds: ['use1-az1'],
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Logs::QueryDefinition', {
        QueryString: Match.stringLikeRegexp('.*limit 1000.*'),
      });
    });

    test('queries include sort clause', () => {
      const logGroup = createMockLogGroup(stack, 'TestLogGroup');

      new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup],
        operation: mockOperation,
        nameSuffix: '-test',
        availabilityZoneIds: ['use1-az1'],
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Logs::QueryDefinition', {
        QueryString: Match.stringLikeRegexp('.*sort @timestamp.*'),
      });
    });
  });

  describe('availability zone handling', () => {
    test('creates queries for single availability zone', () => {
      const logGroup = createMockLogGroup(stack, 'TestLogGroup');

      new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup],
        operation: mockOperation,
        nameSuffix: '-test',
        availabilityZoneIds: ['use1-az1'],
      });

      const template = synthesizeStack(stack);
      const queries = findResourcesByType(template, 'AWS::Logs::QueryDefinition');

      // 3 regional + 3 per-AZ = 6 total
      expect(queries.length).toBe(6);
    });

    test('creates queries for multiple availability zones', () => {
      const logGroup = createMockLogGroup(stack, 'TestLogGroup');

      new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup],
        operation: mockOperation,
        nameSuffix: '-test',
        availabilityZoneIds: ['use1-az1', 'use1-az2', 'use1-az3'],
      });

      const template = synthesizeStack(stack);
      const queries = findResourcesByType(template, 'AWS::Logs::QueryDefinition');

      // 3 regional + 3 per-AZ * 3 AZs = 12 total
      expect(queries.length).toBe(12);
    });

    test('filters queries by availability zone ID', () => {
      const logGroup = createMockLogGroup(stack, 'TestLogGroup');

      new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup],
        operation: mockOperation,
        nameSuffix: '-test',
        availabilityZoneIds: ['use1-az1', 'use1-az2'],
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Logs::QueryDefinition', {
        QueryString: Match.stringLikeRegexp('.*`AZ-ID` = "use1-az1".*'),
      });
      template.hasResourceProperties('AWS::Logs::QueryDefinition', {
        QueryString: Match.stringLikeRegexp('.*`AZ-ID` = "use1-az2".*'),
      });
    });
  });

  describe('CloudFormation resources', () => {
    test('creates correct number of query definitions', () => {
      const logGroup = createMockLogGroup(stack, 'TestLogGroup');

      new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup],
        operation: mockOperation,
        nameSuffix: '-test',
        availabilityZoneIds: ['use1-az1', 'use1-az2'],
      });

      const template = synthesizeStack(stack);
      const count = getResourceCount(template, 'AWS::Logs::QueryDefinition');

      // 3 regional + 3 per-AZ * 2 AZs = 9 total
      expect(count).toBe(9);
    });

    test('query definitions have unique names', () => {
      const logGroup = createMockLogGroup(stack, 'TestLogGroup');

      new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup],
        operation: mockOperation,
        nameSuffix: '-test',
        availabilityZoneIds: ['use1-az1'],
      });

      const template = synthesizeStack(stack);
      const queries = findResourcesByType(template, 'AWS::Logs::QueryDefinition');

      const names = queries.map(q => q.Properties?.Name);
      const uniqueNames = new Set(names);

      expect(uniqueNames.size).toBe(queries.length);
    });
  });

  describe('name suffix handling', () => {
    test('appends name suffix to query names', () => {
      const logGroup = createMockLogGroup(stack, 'TestLogGroup');

      new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup],
        operation: mockOperation,
        nameSuffix: '-production',
        availabilityZoneIds: ['use1-az1'],
      });

      const template = synthesizeStack(stack);
      const queries = findResourcesByType(template, 'AWS::Logs::QueryDefinition');

      expect(queries.length).toBeGreaterThan(0);
    });

    test('handles empty name suffix', () => {
      const logGroup = createMockLogGroup(stack, 'TestLogGroup');

      new OperationLogQueries(stack, 'LogQueries', {
        logGroups: [logGroup],
        operation: mockOperation,
        nameSuffix: '',
        availabilityZoneIds: ['use1-az1'],
      });

      const template = synthesizeStack(stack);
      const count = getResourceCount(template, 'AWS::Logs::QueryDefinition');

      expect(count).toBe(6);
    });
  });
});
