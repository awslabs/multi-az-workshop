// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as arc from 'aws-cdk-lib/aws-route53recoverycontrol';
import { EvacuationMethod } from '../types/evacuation-method';

/**
 * Props for Route53 Health Checks Stack
 */
export interface Route53HealthChecksStackProps extends cdk.NestedStackProps {
  /**
   * Evacuation method to determine health check type
   */
  readonly evacuationMethod: EvacuationMethod;

  /**
   * Domain name for HTTP/HTTPS health checks
   */
  readonly domainName: string;

  /**
   * Resource path for HTTP/HTTPS health checks
   * The template will append "/az-id" onto the url for each health check
   */
  readonly resourcePath: string;

  /**
   * Map of availability zone IDs to routing control ARNs
   * For ARC: maps to CfnRoutingControl resources
   * For HTTP endpoints: maps to zone IDs for path construction
   */
  readonly availabilityZoneIdToRoutingControlArns: Record<string, arc.CfnRoutingControl>;

  /**
   * Whether to invert the health check status
   * @default false
   */
  readonly inverted?: boolean;
}

/**
 * Nested stack that creates Route53 health checks for availability zone monitoring
 */
export class Route53HealthChecksStack extends cdk.NestedStack {
  /**
   * Array of health check resources
   */
  public readonly healthChecks: route53.CfnHealthCheck[];

  constructor(scope: cdk.Stack, id: string, props: Route53HealthChecksStackProps) {
    super(scope, id, props);

    const inverted = props.inverted ?? false;
    const azEntries = Object.entries(props.availabilityZoneIdToRoutingControlArns);

    this.healthChecks = [];

    for (let i = 0; i < azEntries.length; i++) {
      const [azId, routingControl] = azEntries[i];

      let healthCheck: route53.CfnHealthCheck;

      switch (props.evacuationMethod) {
        case EvacuationMethod.SelfManagedHttpEndpoint_S3:
        case EvacuationMethod.SelfManagedHttpEndpoint_APIG:
          // Create HTTP/HTTPS health check
          healthCheck = new route53.CfnHealthCheck(this, `az${i + 1}`, {
            healthCheckConfig: {
              failureThreshold: 1,
              fullyQualifiedDomainName: props.domainName,
              resourcePath: cdk.Fn.sub('${ResourcePath}${AZID}', {
                ResourcePath: props.resourcePath,
                AZID: azId,
              }),
              port: 443,
              type: 'HTTPS',
              inverted,
            },
          });
          break;

        case EvacuationMethod.ARC:
          // Create Application Recovery Controller health check
          healthCheck = new route53.CfnHealthCheck(this, `AZ${i + 1}`, {
            healthCheckConfig: {
              type: 'RECOVERY_CONTROL',
              routingControlArn: routingControl.ref,
            },
          });
          break;

        default:
          throw new Error(`Unsupported evacuation method: ${props.evacuationMethod}`);
      }

      this.healthChecks.push(healthCheck);
    }
  }
}
