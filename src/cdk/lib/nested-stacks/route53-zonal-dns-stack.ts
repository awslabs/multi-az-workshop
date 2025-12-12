// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { LoadBalancerZonalDnsRecords } from '../constructs/load-balancer-zonal-dns-records';

/**
 * Props for Route53 Zonal DNS Stack
 */
export interface Route53ZonalDnsStackProps extends cdk.NestedStackProps {
  /**
   * VPC where the private hosted zone will be created
   */
  readonly vpc: ec2.IVpc;

  /**
   * Domain name for the hosted zone
   * @default 'example.com'
   */
  readonly domain?: string;

  /**
   * Load balancer to create DNS records for
   */
  readonly loadBalancer: elbv2.ILoadBalancerV2;

  /**
   * Map of availability zone names to zone IDs
   */
  readonly availabilityZoneMap: Record<string, string>;
}

/**
 * Nested stack that creates a private hosted zone with zonal DNS records
 * for load balancer endpoints
 */
export class Route53ZonalDnsStack extends cdk.NestedStack {
  /**
   * The private hosted zone
   */
  public readonly hostedZone: route53.HostedZone;

  /**
   * Array of zonal DNS names (one per AZ)
   */
  public readonly frontEndZonalDnsNames: string[];

  /**
   * Regional DNS name for the load balancer
   */
  public readonly frontEndRegionalDnsName: string;

  constructor(scope: cdk.Stack, id: string, props: Route53ZonalDnsStackProps) {
    super(scope, id, props);

    const domain = props.domain ?? 'example.com';
    const addTrailingDot = !domain.endsWith('.');

    // Create private hosted zone
    this.hostedZone = new route53.PrivateHostedZone(this, 'phz', {
      vpc: props.vpc,
      zoneName: domain,
      addTrailingDot,
    });

    // Create zonal DNS records for the load balancer
    const dns = new LoadBalancerZonalDnsRecords(this, 'zonalDns', {
      hostedZone: this.hostedZone,
      loadBalancer: props.loadBalancer,
      topLevelDomainPrefix: 'www',
      availabilityZoneMap: props.availabilityZoneMap,
      addWeightedRecord: true,
    });

    this.frontEndZonalDnsNames = dns.zonalDnsNames;
    this.frontEndRegionalDnsName = `www.${this.hostedZone.zoneName}.`;
  }
}
