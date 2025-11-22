// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import {
  AddCanaryTestProps,
  CanaryTestLatencyMetricsOverride,
  CanaryTestLatencyMetricsOverrideProps,
  ContributorInsightRuleDetails,
  ContributorInsightRuleDetailsProps,
  IService,
  MetricDimensions,
  MinimumUnhealthyTargets,
  NetworkConfigurationProps,
  Operation,
  OperationAvailabilityMetricDetails,
  OperationAvailabilityMetricDetailsProps,
  OperationLatencyMetricDetails,
  OperationLatencyMetricDetailsProps,
  OperationProps,
  Service,
  ServiceAvailabilityMetricDetails,
  ServiceAvailabilityMetricDetailsProps,
  ServiceLatencyMetricDetails,
  ServiceLatencyMetricDetailsProps,
  ServiceProps,
} from '@cdklabs/multi-az-observability';

/**
 * Options for creating a service with multi-AZ observability
 */
export interface CreateServiceOptions {
  /**
   * The load balancer for the service
   */
  readonly loadBalancer: elbv2.ILoadBalancerV2;

  /**
   * The VPC where the service is deployed
   */
  readonly vpc: ec2.IVpc;

  /**
   * Log groups for server-side logging
   */
  readonly serverLogGroups: logs.ILogGroup[];

  /**
   * Optional target groups for the load balancer
   */
  readonly targetGroups?: elbv2.IApplicationTargetGroup[];
}

// Constants for service configuration
const METRICS_NAMESPACE = 'multi-az-workshop/frontend';
const FAULT_METRIC_JSON_PATH = '$.Fault';
const SUCCESS_LATENCY_METRIC_JSON_PATH = '$.SuccessLatency';
const AZ_ID_JSON_PATH = '$.AZ-ID';
const OPERATION_NAME_JSON_PATH = '$.Operation';
const INSTANCE_ID_JSON_PATH = '$.InstanceId';

/**
 * Creates a service with multi-AZ observability configuration
 * 
 * This function creates a WildRydes service with four operations:
 * - Signin: User authentication endpoint
 * - Pay: Payment processing endpoint
 * - Ride: Ride booking endpoint
 * - Home: Home page endpoint
 * 
 * Each operation is configured with availability and latency metrics,
 * contributor insight rules, and canary tests.
 * 
 * @param options - Configuration options for the service
 * @returns The configured service instance
 */
export function createService(options: CreateServiceOptions): IService {
  const { loadBalancer, vpc, serverLogGroups, targetGroups } = options;

  // Create the service with default metric configurations
  const newService = new Service({
    serviceName: 'WildRydes',
    baseUrl: 'http://www.example.com',
    faultCountThreshold: 25,
    availabilityZoneNames: vpc.availabilityZones,
    period: cdk.Duration.seconds(60),
    loadBalancer,
    targetGroups,
    defaultAvailabilityMetricDetails: new ServiceAvailabilityMetricDetails({
      alarmStatistic: 'Sum',
      datapointsToAlarm: 2,
      evaluationPeriods: 3,
      faultAlarmThreshold: 1,
      faultMetricNames: ['Fault', 'Failure'],
      graphedFaultStatistics: ['Sum'],
      graphedSuccessStatistics: ['Sum'],
      metricNamespace: METRICS_NAMESPACE,
      period: cdk.Duration.seconds(60),
      successAlarmThreshold: 99,
      successMetricNames: ['Success'],
      unit: cdk.aws_cloudwatch.Unit.COUNT,
    } as ServiceAvailabilityMetricDetailsProps),
    defaultLatencyMetricDetails: new ServiceLatencyMetricDetails({
      alarmStatistic: 'p99',
      datapointsToAlarm: 2,
      evaluationPeriods: 3,
      faultMetricNames: ['FaultLatency'],
      graphedFaultStatistics: ['p50'],
      graphedSuccessStatistics: ['p50', 'p99', 'tm99'],
      metricNamespace: METRICS_NAMESPACE,
      period: cdk.Duration.seconds(60),
      successAlarmThreshold: cdk.Duration.millis(100),
      successMetricNames: ['SuccessLatency'],
      unit: cdk.aws_cloudwatch.Unit.MILLISECONDS,
    } as ServiceLatencyMetricDetailsProps),
    defaultContributorInsightRuleDetails: new ContributorInsightRuleDetails({
      availabilityZoneIdJsonPath: AZ_ID_JSON_PATH,
      faultMetricJsonPath: FAULT_METRIC_JSON_PATH,
      instanceIdJsonPath: INSTANCE_ID_JSON_PATH,
      logGroups: serverLogGroups,
      operationNameJsonPath: OPERATION_NAME_JSON_PATH,
      successLatencyMetricJsonPath: SUCCESS_LATENCY_METRIC_JSON_PATH,
    } as ContributorInsightRuleDetailsProps),
    canaryTestProps: {
      requestCount: 60,
      regionalRequestCount: 60,
      loadBalancer,
      schedule: 'rate(1 minute)',
      timeout: cdk.Duration.seconds(3),
      networkConfiguration: {
        vpc,
        subnetSelection: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      } as NetworkConfigurationProps,
    } as AddCanaryTestProps,
    minimumUnhealthyTargets: {
      percentage: 0.1,
    } as MinimumUnhealthyTargets,
  } as ServiceProps);

  // Add Signin operation
  newService.addOperation(
    new Operation({
      operationName: 'Signin',
      path: '/signin',
      service: newService,
      critical: true,
      httpMethods: ['GET'],
      serverSideAvailabilityMetricDetails: new OperationAvailabilityMetricDetails(
        {
          operationName: 'Signin',
          metricDimensions: new MetricDimensions(
            { Operation: 'Signin' },
            'AZ-ID',
            'Region'
          ),
        } as OperationAvailabilityMetricDetailsProps,
        newService.defaultAvailabilityMetricDetails
      ),
      serverSideLatencyMetricDetails: new OperationLatencyMetricDetails(
        {
          operationName: 'Signin',
          successAlarmThreshold: cdk.Duration.millis(150),
          metricDimensions: new MetricDimensions(
            { Operation: 'Signin' },
            'AZ-ID',
            'Region'
          ),
        } as OperationLatencyMetricDetailsProps,
        newService.defaultLatencyMetricDetails
      ),
      canaryTestLatencyMetricsOverride: new CanaryTestLatencyMetricsOverride({
        successAlarmThreshold: cdk.Duration.millis(500),
      } as CanaryTestLatencyMetricsOverrideProps),
    } as OperationProps)
  );

  // Add Pay operation
  newService.addOperation(
    new Operation({
      operationName: 'Pay',
      path: '/pay',
      service: newService,
      httpMethods: ['GET'],
      critical: true,
      serverSideAvailabilityMetricDetails: new OperationAvailabilityMetricDetails(
        {
          operationName: 'Pay',
          metricDimensions: new MetricDimensions(
            { Operation: 'Pay' },
            'AZ-ID',
            'Region'
          ),
        } as OperationAvailabilityMetricDetailsProps,
        newService.defaultAvailabilityMetricDetails
      ),
      serverSideLatencyMetricDetails: new OperationLatencyMetricDetails(
        {
          operationName: 'Pay',
          successAlarmThreshold: cdk.Duration.millis(200),
          metricDimensions: new MetricDimensions(
            { Operation: 'Pay' },
            'AZ-ID',
            'Region'
          ),
        } as OperationLatencyMetricDetailsProps,
        newService.defaultLatencyMetricDetails
      ),
      canaryTestLatencyMetricsOverride: new CanaryTestLatencyMetricsOverride({
        successAlarmThreshold: cdk.Duration.millis(500),
      } as CanaryTestLatencyMetricsOverrideProps),
    } as OperationProps)
  );

  // Add Ride operation
  newService.addOperation(
    new Operation({
      operationName: 'Ride',
      path: '/ride',
      service: newService,
      httpMethods: ['GET'],
      critical: true,
      serverSideAvailabilityMetricDetails: new OperationAvailabilityMetricDetails(
        {
          operationName: 'Ride',
          metricDimensions: new MetricDimensions(
            { Operation: 'Ride' },
            'AZ-ID',
            'Region'
          ),
        } as OperationAvailabilityMetricDetailsProps,
        newService.defaultAvailabilityMetricDetails
      ),
      serverSideLatencyMetricDetails: new OperationLatencyMetricDetails(
        {
          operationName: 'Ride',
          successAlarmThreshold: cdk.Duration.millis(350),
          metricDimensions: new MetricDimensions(
            { Operation: 'Ride' },
            'AZ-ID',
            'Region'
          ),
        } as OperationLatencyMetricDetailsProps,
        newService.defaultLatencyMetricDetails
      ),
      canaryTestLatencyMetricsOverride: new CanaryTestLatencyMetricsOverride({
        successAlarmThreshold: cdk.Duration.millis(650),
      } as CanaryTestLatencyMetricsOverrideProps),
    } as OperationProps)
  );

  // Add Home operation
  newService.addOperation(
    new Operation({
      operationName: 'Home',
      path: '/home',
      service: newService,
      httpMethods: ['GET'],
      critical: true,
      serverSideAvailabilityMetricDetails: new OperationAvailabilityMetricDetails(
        {
          operationName: 'Home',
          metricDimensions: new MetricDimensions(
            { Operation: 'Home' },
            'AZ-ID',
            'Region'
          ),
        } as OperationAvailabilityMetricDetailsProps,
        newService.defaultAvailabilityMetricDetails
      ),
      serverSideLatencyMetricDetails: new OperationLatencyMetricDetails(
        {
          operationName: 'Home',
          successAlarmThreshold: cdk.Duration.millis(100),
          metricDimensions: new MetricDimensions(
            { Operation: 'Home' },
            'AZ-ID',
            'Region'
          ),
        } as OperationLatencyMetricDetailsProps,
        newService.defaultLatencyMetricDetails
      ),
      canaryTestLatencyMetricsOverride: new CanaryTestLatencyMetricsOverride({
        successAlarmThreshold: cdk.Duration.millis(500),
      } as CanaryTestLatencyMetricsOverrideProps),
    } as OperationProps)
  );

  return newService;
}
