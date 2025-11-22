// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import { IService } from 'cdklabs.multi-az-observability';
import { OperationLogQueries } from '../constructs/operation-log-queries';

/**
 * Props for Log Query Stack
 */
export interface LogQueryStackProps extends cdk.NestedStackProps {
  /**
   * Log group for server-side logs
   */
  readonly serverSideLogGroup: logs.ILogGroup;

  /**
   * Log group for canary logs (optional)
   */
  readonly canaryLogGroup?: logs.ILogGroup;

  /**
   * Service definition containing operations
   */
  readonly service: IService;

  /**
   * Availability zone IDs
   */
  readonly availabilityZoneIds: string[];
}

/**
 * Nested stack that creates CloudWatch Insights queries for service operations
 */
export class LogQueryStack extends cdk.NestedStack {
  constructor(scope: cdk.Stack, id: string, props: LogQueryStackProps) {
    super(scope, id, props);

    // Create log queries for each operation in the service
    for (const operation of props.service.operations) {
      // Create server-side log queries
      new OperationLogQueries(this, `${operation.operationName}ServerLogQueries`, {
        logGroups: [props.serverSideLogGroup],
        operation: operation,
        nameSuffix: '-server',
        availabilityZoneIds: props.availabilityZoneIds,
      });

      // Create canary log queries if canary log group is provided
      if (props.canaryLogGroup) {
        new OperationLogQueries(this, `${operation.operationName}CanaryLogQueries`, {
          logGroups: [props.canaryLogGroup],
          operation: operation,
          nameSuffix: '-canary',
          availabilityZoneIds: props.availabilityZoneIds,
        });
      }
    }
  }
}
