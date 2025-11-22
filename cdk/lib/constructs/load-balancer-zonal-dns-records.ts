// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';

/**
 * Props for LoadBalancerZonalDnsRecords
 */
export interface LoadBalancerZonalDnsRecordsProps {
  /**
   * Load balancer to create DNS records for
   */
  readonly loadBalancer: elbv2.ILoadBalancerV2;

  /**
   * Hosted zone to create records in
   */
  readonly hostedZone: route53.IHostedZone;

  /**
   * Whether to add weighted records
   */
  readonly addWeightedRecord: boolean;

  /**
   * Prefix for the top-level domain
   */
  readonly topLevelDomainPrefix: string;

  /**
   * Map of availability zone names to zone IDs
   */
  readonly availabilityZoneMap: Record<string, string>;
}

/**
 * Creates zonal DNS records for a load balancer
 */
export class LoadBalancerZonalDnsRecords extends Construct {
  public readonly zonalDnsNames: string[];
  public readonly regionalDnsName: string;
  public readonly zoneNameToZoneIdDnsNames: Record<string, string>;

  constructor(scope: cdk.Stack, id: string, props: LoadBalancerZonalDnsRecordsProps) {
    super(scope, id);

    this.zoneNameToZoneIdDnsNames = {};
    this.zonalDnsNames = [];

    this.regionalDnsName = cdk.Fn.join('', [props.topLevelDomainPrefix, '.', props.hostedZone.zoneName, '.']);

    const azMapEntries = Object.entries(props.availabilityZoneMap);

    for (let i = 0; i < azMapEntries.length; i++) {
      const [zoneName, zoneId] = azMapEntries[i];

      const recordSet = new route53.CfnRecordSet(this, `Record${i}`, {
        aliasTarget: {
          dnsName: cdk.Fn.join('.', [zoneName, props.loadBalancer.loadBalancerDnsName]),
          evaluateTargetHealth: true,
          hostedZoneId: props.loadBalancer.loadBalancerCanonicalHostedZoneId,
        },
        name: cdk.Fn.join('', [zoneId, '.', props.hostedZone.zoneName, '.']),
        type: 'A',
        hostedZoneId: props.hostedZone.hostedZoneId,
      });

      this.zonalDnsNames.push(recordSet.name);
      this.zoneNameToZoneIdDnsNames[zoneName] = recordSet.name;

      new route53.CfnRecordSet(this, `WeightedRecord${i}`, {
        aliasTarget: {
          dnsName: cdk.Fn.join('.', [zoneName, props.loadBalancer.loadBalancerDnsName]),
          evaluateTargetHealth: true,
          hostedZoneId: props.loadBalancer.loadBalancerCanonicalHostedZoneId,
        },
        name: this.regionalDnsName,
        type: 'A',
        hostedZoneId: props.hostedZone.hostedZoneId,
        weight: 100,
        setIdentifier: zoneId,
      });
    }
  }
}
