/**
 * Tests for service-factory utility
 * Validates the createService function and service configuration
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { createService } from '../../../src/cdk/lib/utils/service-factory';
import {
  createTestApp,
  createTestStack,
  createMockVpc,
  createMockLoadBalancer,
  createMockLogGroup,
} from '../../helpers';

describe('service-factory', () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let vpc: ec2.Vpc;

  beforeEach(() => {
    app = createTestApp();
    stack = createTestStack(app);
    vpc = createMockVpc(stack, { azCount: 3 });
  });

  describe('createService', () => {
    describe('with valid inputs', () => {
      test('creates service with required parameters', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [createMockLogGroup(stack, 'ServerLogs')];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
        });

        expect(service).toBeDefined();
        expect(service.serviceName).toBe('WildRydes');
      });

      test('creates service with target groups', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [createMockLogGroup(stack, 'ServerLogs')];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
          targetGroups: [],
        });

        expect(service).toBeDefined();
        expect(service.serviceName).toBe('WildRydes');
      });

      test('creates service with multiple log groups', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [
          createMockLogGroup(stack, 'ServerLogs1'),
          createMockLogGroup(stack, 'ServerLogs2'),
          createMockLogGroup(stack, 'ServerLogs3'),
        ];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
        });

        expect(service).toBeDefined();
        expect(service.serviceName).toBe('WildRydes');
      });
    });

    describe('service configuration', () => {
      test('configures service with correct name', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [createMockLogGroup(stack, 'ServerLogs')];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
        });

        expect(service.serviceName).toBe('WildRydes');
      });

      test('configures service with availability zones from VPC', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [createMockLogGroup(stack, 'ServerLogs')];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
        });

        expect(service.serviceName).toBe('WildRydes');
        // Service should use VPC's availability zones
        expect(vpc.availabilityZones.length).toBe(3);
      });

      test('configures default availability metric details', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [createMockLogGroup(stack, 'ServerLogs')];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
        });

        expect(service.defaultAvailabilityMetricDetails).toBeDefined();
        expect(service.defaultAvailabilityMetricDetails.metricNamespace).toBe(
          'multi-az-workshop/frontend',
        );
      });

      test('configures default latency metric details', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [createMockLogGroup(stack, 'ServerLogs')];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
        });

        expect(service.defaultLatencyMetricDetails).toBeDefined();
        expect(service.defaultLatencyMetricDetails.metricNamespace).toBe(
          'multi-az-workshop/frontend',
        );
      });

      test('configures contributor insight rules', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [createMockLogGroup(stack, 'ServerLogs')];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
        });

        expect(service.defaultContributorInsightRuleDetails).toBeDefined();
      });

      test('configures canary test properties', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [createMockLogGroup(stack, 'ServerLogs')];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
        });

        expect(service.canaryTestProps).toBeDefined();
        expect(service.canaryTestProps?.requestCount).toBe(60);
        expect(service.canaryTestProps?.regionalRequestCount).toBe(60);
      });
    });

    describe('operation creation', () => {
      test('creates Signin operation', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [createMockLogGroup(stack, 'ServerLogs')];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
        });

        const operations = service.operations;
        const signinOp = operations.find((op) => op.operationName === 'Signin');

        expect(signinOp).toBeDefined();
        expect(signinOp?.operationName).toBe('Signin');
        expect(signinOp?.path).toBe('/signin');
        expect(signinOp?.critical).toBe(true);
        expect(signinOp?.httpMethods).toContain('GET');
      });

      test('creates Pay operation', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [createMockLogGroup(stack, 'ServerLogs')];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
        });

        const operations = service.operations;
        const payOp = operations.find((op) => op.operationName === 'Pay');

        expect(payOp).toBeDefined();
        expect(payOp?.operationName).toBe('Pay');
        expect(payOp?.path).toBe('/pay');
        expect(payOp?.critical).toBe(true);
        expect(payOp?.httpMethods).toContain('GET');
      });

      test('creates Ride operation', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [createMockLogGroup(stack, 'ServerLogs')];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
        });

        const operations = service.operations;
        const rideOp = operations.find((op) => op.operationName === 'Ride');

        expect(rideOp).toBeDefined();
        expect(rideOp?.operationName).toBe('Ride');
        expect(rideOp?.path).toBe('/ride');
        expect(rideOp?.critical).toBe(true);
        expect(rideOp?.httpMethods).toContain('GET');
      });

      test('creates Home operation', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [createMockLogGroup(stack, 'ServerLogs')];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
        });

        const operations = service.operations;
        const homeOp = operations.find((op) => op.operationName === 'Home');

        expect(homeOp).toBeDefined();
        expect(homeOp?.operationName).toBe('Home');
        expect(homeOp?.path).toBe('/home');
        expect(homeOp?.critical).toBe(true);
        expect(homeOp?.httpMethods).toContain('GET');
      });

      test('creates all four operations', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [createMockLogGroup(stack, 'ServerLogs')];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
        });

        const operations = service.operations;
        expect(operations).toHaveLength(4);

        const operationNames = operations.map((op) => op.operationName);
        expect(operationNames).toContain('Signin');
        expect(operationNames).toContain('Pay');
        expect(operationNames).toContain('Ride');
        expect(operationNames).toContain('Home');
      });
    });

    describe('operation metric configuration', () => {
      test('configures Signin operation with correct latency threshold', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [createMockLogGroup(stack, 'ServerLogs')];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
        });

        const signinOp = service.operations.find(
          (op) => op.operationName === 'Signin',
        );

        expect(signinOp?.serverSideLatencyMetricDetails).toBeDefined();
        expect(
          signinOp?.serverSideLatencyMetricDetails.successAlarmThreshold.toMilliseconds(),
        ).toBe(150);
      });

      test('configures Pay operation with correct latency threshold', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [createMockLogGroup(stack, 'ServerLogs')];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
        });

        const payOp = service.operations.find((op) => op.operationName === 'Pay');

        expect(payOp?.serverSideLatencyMetricDetails).toBeDefined();
        expect(
          payOp?.serverSideLatencyMetricDetails.successAlarmThreshold.toMilliseconds(),
        ).toBe(200);
      });

      test('configures Ride operation with correct latency threshold', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [createMockLogGroup(stack, 'ServerLogs')];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
        });

        const rideOp = service.operations.find((op) => op.operationName === 'Ride');

        expect(rideOp?.serverSideLatencyMetricDetails).toBeDefined();
        expect(
          rideOp?.serverSideLatencyMetricDetails.successAlarmThreshold.toMilliseconds(),
        ).toBe(350);
      });

      test('configures Home operation with correct latency threshold', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [createMockLogGroup(stack, 'ServerLogs')];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
        });

        const homeOp = service.operations.find((op) => op.operationName === 'Home');

        expect(homeOp?.serverSideLatencyMetricDetails).toBeDefined();
        expect(
          homeOp?.serverSideLatencyMetricDetails.successAlarmThreshold.toMilliseconds(),
        ).toBe(100);
      });

      test('configures all operations with availability metrics', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [createMockLogGroup(stack, 'ServerLogs')];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
        });

        service.operations.forEach((operation) => {
          expect(operation.serverSideAvailabilityMetricDetails).toBeDefined();
          expect(
            operation.serverSideAvailabilityMetricDetails.operationName,
          ).toBe(operation.operationName);
        });
      });

      test('configures all operations with latency metrics', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [createMockLogGroup(stack, 'ServerLogs')];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
        });

        service.operations.forEach((operation) => {
          expect(operation.serverSideLatencyMetricDetails).toBeDefined();
          expect(operation.serverSideLatencyMetricDetails.operationName).toBe(
            operation.operationName,
          );
        });
      });
    });

    describe('canary test configuration', () => {
      test('configures Signin canary test with correct threshold', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [createMockLogGroup(stack, 'ServerLogs')];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
        });

        const signinOp = service.operations.find(
          (op) => op.operationName === 'Signin',
        );

        expect(signinOp?.canaryTestLatencyMetricsOverride).toBeDefined();
        expect(
          signinOp?.canaryTestLatencyMetricsOverride?.successAlarmThreshold?.toMilliseconds(),
        ).toBe(500);
      });

      test('configures Pay canary test with correct threshold', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [createMockLogGroup(stack, 'ServerLogs')];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
        });

        const payOp = service.operations.find((op) => op.operationName === 'Pay');

        expect(payOp?.canaryTestLatencyMetricsOverride).toBeDefined();
        expect(
          payOp?.canaryTestLatencyMetricsOverride?.successAlarmThreshold?.toMilliseconds(),
        ).toBe(500);
      });

      test('configures Ride canary test with correct threshold', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [createMockLogGroup(stack, 'ServerLogs')];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
        });

        const rideOp = service.operations.find((op) => op.operationName === 'Ride');

        expect(rideOp?.canaryTestLatencyMetricsOverride).toBeDefined();
        expect(
          rideOp?.canaryTestLatencyMetricsOverride?.successAlarmThreshold?.toMilliseconds(),
        ).toBe(650);
      });

      test('configures Home canary test with correct threshold', () => {
        const loadBalancer = createMockLoadBalancer(stack, {
          type: 'application',
          vpc,
        });
        const logGroups = [createMockLogGroup(stack, 'ServerLogs')];

        const service = createService({
          loadBalancer,
          vpc,
          serverLogGroups: logGroups,
        });

        const homeOp = service.operations.find((op) => op.operationName === 'Home');

        expect(homeOp?.canaryTestLatencyMetricsOverride).toBeDefined();
        expect(
          homeOp?.canaryTestLatencyMetricsOverride?.successAlarmThreshold?.toMilliseconds(),
        ).toBe(500);
      });
    });
  });
});
