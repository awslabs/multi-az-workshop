// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { IOperation } from '@cdklabs/multi-az-observability';
import * as cdk from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/**
 * Props for OperationLogQueries
 */
export interface OperationLogQueriesProps {
  /**
   * Log groups to query
   */
  readonly logGroups: logs.ILogGroup[];

  /**
   * Operation to create queries for
   */
  readonly operation: IOperation;

  /**
   * Suffix to add to query names
   */
  readonly nameSuffix: string;

  /**
   * Availability zone IDs
   */
  readonly availabilityZoneIds: string[];
}

/**
 * Creates CloudWatch Insights query definitions for an operation
 */
export class OperationLogQueries extends Construct {
  constructor(scope: Construct, id: string, props: OperationLogQueriesProps) {
    super(scope, id);

    // Regional request log query
    new logs.QueryDefinition(this, props.operation.operationName + 'RequestsLogQuery', {
      logGroups: props.logGroups,
      queryDefinitionName:
        cdk.Fn.ref('AWS::Region') + '-' + props.operation.operationName.toLowerCase() + '-requests' + props.nameSuffix,
      queryString: new logs.QueryString({
        fields: ['RequestId', 'SuccessLatency', '`AZ-ID`'],
        filterStatements: [`Operation = "${props.operation.operationName}"`],
        limit: 1000,
        sort: '@timestamp',
      }),
    });

    // Regional high latency log query
    new logs.QueryDefinition(this, props.operation.operationName + 'HighLatencyRequestsLogQuery', {
      logGroups: props.logGroups,
      queryDefinitionName:
        cdk.Fn.ref('AWS::Region') +
        '-' +
        props.operation.operationName +
        '-high-latency-requests' +
        props.nameSuffix,
      queryString: new logs.QueryString({
        fields: ['RequestId', 'SuccessLatency', '`AZ-ID`'],
        filterStatements: [
          `Operation = "${props.operation.operationName}"`,
          `SuccessLatency > ${props.operation.serverSideLatencyMetricDetails.successAlarmThreshold}`,
        ],
        limit: 1000,
        sort: '@timestamp',
      }),
    });

    // Regional fault log query
    new logs.QueryDefinition(this, props.operation.operationName + 'FaultLogQuery', {
      logGroups: props.logGroups,
      queryDefinitionName:
        cdk.Fn.ref('AWS::Region') + '-' + props.operation.operationName + '-faults' + props.nameSuffix,
      queryString: new logs.QueryString({
        fields: ['RequestId', 'SuccessLatency', '`AZ-ID`'],
        filterStatements: [`Operation = "${props.operation.operationName}"`, 'Fault = 1 or Failure = 1'],
        limit: 1000,
        sort: '@timestamp',
      }),
    });

    // Per-AZ queries
    for (let i = 0; i < props.availabilityZoneIds.length; i++) {
      const azId = props.availabilityZoneIds[i];

      // AZ request log query
      new logs.QueryDefinition(this, props.operation.operationName + 'az' + i + 'AZRequestsLogQuery', {
        logGroups: props.logGroups,
        queryDefinitionName: azId + '-' + props.operation.operationName + '-requests' + props.nameSuffix,
        queryString: new logs.QueryString({
          fields: ['RequestId', 'SuccessLatency', '`AZ-ID`'],
          filterStatements: [`\`AZ-ID\` = "${azId}"`, `Operation = "${props.operation.operationName}"`],
          limit: 1000,
          sort: '@timestamp',
        }),
      });

      // AZ high latency log query
      new logs.QueryDefinition(this, props.operation.operationName + 'az' + i + 'HighLatencyLogQuery', {
        logGroups: props.logGroups,
        queryDefinitionName: azId + '-' + props.operation.operationName + '-high-latency-requests' + props.nameSuffix,
        queryString: new logs.QueryString({
          fields: ['RequestId', 'SuccessLatency', '`AZ-ID`'],
          filterStatements: [
            `\`AZ-ID\` = "${azId}"`,
            `Operation = "${props.operation.operationName}"`,
            `SuccessLatency > ${props.operation.serverSideLatencyMetricDetails.successAlarmThreshold}`,
          ],
          limit: 1000,
          sort: '@timestamp',
        }),
      });

      // AZ fault log query
      new logs.QueryDefinition(this, props.operation.operationName + 'az' + i + 'FaultLogQuery', {
        logGroups: props.logGroups,
        queryDefinitionName: azId + '-' + props.operation.operationName + '-faults' + props.nameSuffix,
        queryString: new logs.QueryString({
          fields: ['RequestId', 'SuccessLatency', '`AZ-ID`'],
          filterStatements: [
            `\`AZ-ID\` = "${azId}"`,
            `Operation = "${props.operation.operationName}"`,
            'Fault = 1 or Failure = 1',
          ],
          limit: 1000,
          sort: '@timestamp',
        }),
      });
    }
  }
}
