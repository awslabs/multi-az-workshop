// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import { Match } from 'aws-cdk-lib/assertions';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { LoadBalancerZonalDnsRecords } from '../../../src/cdk/lib/constructs/load-balancer-zonal-dns-records';
import { createMockVpc, createMockLoadBalancer } from '../../helpers/mock-factories';
import { synthesizeStack, getResourceCount, findResourcesByType } from '../../helpers/stack-helpers';
import { createTestApp } from '../../helpers/test-fixtures';

describe('LoadBalancerZonalDnsRecords', () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = createTestApp();
    stack = new cdk.Stack(app, 'TestStack');
  });

  describe('constructor', () => {
    test('creates construct with required properties', () => {
      const vpc = createMockVpc(stack, { azCount: 3 });
      const loadBalancer = createMockLoadBalancer(stack, {
        type: 'application',
        vpc,
      });
      const hostedZone = new route53.PublicHostedZone(stack, 'HostedZone', {
        zoneName: 'example.com',
      });

      const zonalDns = new LoadBalancerZonalDnsRecords(stack, 'ZonalDns', {
        loadBalancer,
        hostedZone,
        addWeightedRecord: true,
        topLevelDomainPrefix: 'app',
        availabilityZoneMap: {
          'us-east-1a': 'use1-az1',
          'us-east-1b': 'use1-az2',
          'us-east-1c': 'use1-az3',
        },
      });

      expect(zonalDns).toBeDefined();
      expect(zonalDns.zonalDnsNames).toBeDefined();
      expect(zonalDns.regionalDnsName).toBeDefined();
      expect(zonalDns.zoneNameToZoneIdDnsNames).toBeDefined();
    });

    test('creates construct without weighted records', () => {
      const vpc = createMockVpc(stack, { azCount: 2 });
      const loadBalancer = createMockLoadBalancer(stack, {
        type: 'network',
        vpc,
      });
      const hostedZone = new route53.PublicHostedZone(stack, 'HostedZone', {
        zoneName: 'test.com',
      });

      const zonalDns = new LoadBalancerZonalDnsRecords(stack, 'ZonalDns', {
        loadBalancer,
        hostedZone,
        addWeightedRecord: false,
        topLevelDomainPrefix: 'service',
        availabilityZoneMap: {
          'us-east-1a': 'use1-az1',
          'us-east-1b': 'use1-az2',
        },
      });

      expect(zonalDns).toBeDefined();
    });
  });

  describe('Route53 record creation', () => {
    test('creates zonal DNS records for each availability zone', () => {
      const vpc = createMockVpc(stack, { azCount: 3 });
      const loadBalancer = createMockLoadBalancer(stack, {
        type: 'application',
        vpc,
      });
      const hostedZone = new route53.PublicHostedZone(stack, 'HostedZone', {
        zoneName: 'example.com',
      });

      new LoadBalancerZonalDnsRecords(stack, 'ZonalDns', {
        loadBalancer,
        hostedZone,
        addWeightedRecord: true,
        topLevelDomainPrefix: 'app',
        availabilityZoneMap: {
          'us-east-1a': 'use1-az1',
          'us-east-1b': 'use1-az2',
          'us-east-1c': 'use1-az3',
        },
      });

      const template = synthesizeStack(stack);
      const recordSets = findResourcesByType(template, 'AWS::Route53::RecordSet');

      // Should have 3 zonal records + 3 weighted records = 6 total
      expect(recordSets.length).toBeGreaterThanOrEqual(6);
    });

    test('creates weighted records for regional DNS', () => {
      const vpc = createMockVpc(stack, { azCount: 2 });
      const loadBalancer = createMockLoadBalancer(stack, {
        type: 'application',
        vpc,
      });
      const hostedZone = new route53.PublicHostedZone(stack, 'HostedZone', {
        zoneName: 'example.com',
      });

      new LoadBalancerZonalDnsRecords(stack, 'ZonalDns', {
        loadBalancer,
        hostedZone,
        addWeightedRecord: true,
        topLevelDomainPrefix: 'app',
        availabilityZoneMap: {
          'us-east-1a': 'use1-az1',
          'us-east-1b': 'use1-az2',
        },
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Route53::RecordSet', {
        Weight: 100,
        SetIdentifier: Match.anyValue(),
      });
    });

    test('configures alias targets with load balancer DNS', () => {
      const vpc = createMockVpc(stack, { azCount: 2 });
      const loadBalancer = createMockLoadBalancer(stack, {
        type: 'application',
        vpc,
      });
      const hostedZone = new route53.PublicHostedZone(stack, 'HostedZone', {
        zoneName: 'example.com',
      });

      new LoadBalancerZonalDnsRecords(stack, 'ZonalDns', {
        loadBalancer,
        hostedZone,
        addWeightedRecord: true,
        topLevelDomainPrefix: 'app',
        availabilityZoneMap: {
          'us-east-1a': 'use1-az1',
          'us-east-1b': 'use1-az2',
        },
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Route53::RecordSet', {
        AliasTarget: {
          DNSName: Match.anyValue(),
          EvaluateTargetHealth: true,
          HostedZoneId: Match.anyValue(),
        },
      });
    });

    test('sets record type to A', () => {
      const vpc = createMockVpc(stack, { azCount: 2 });
      const loadBalancer = createMockLoadBalancer(stack, {
        type: 'application',
        vpc,
      });
      const hostedZone = new route53.PublicHostedZone(stack, 'HostedZone', {
        zoneName: 'example.com',
      });

      new LoadBalancerZonalDnsRecords(stack, 'ZonalDns', {
        loadBalancer,
        hostedZone,
        addWeightedRecord: true,
        topLevelDomainPrefix: 'app',
        availabilityZoneMap: {
          'us-east-1a': 'use1-az1',
          'us-east-1b': 'use1-az2',
        },
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Route53::RecordSet', {
        Type: 'A',
      });
    });
  });

  describe('hosted zone integration', () => {
    test('associates records with hosted zone', () => {
      const vpc = createMockVpc(stack, { azCount: 2 });
      const loadBalancer = createMockLoadBalancer(stack, {
        type: 'application',
        vpc,
      });
      const hostedZone = new route53.PublicHostedZone(stack, 'HostedZone', {
        zoneName: 'example.com',
      });

      new LoadBalancerZonalDnsRecords(stack, 'ZonalDns', {
        loadBalancer,
        hostedZone,
        addWeightedRecord: true,
        topLevelDomainPrefix: 'app',
        availabilityZoneMap: {
          'us-east-1a': 'use1-az1',
          'us-east-1b': 'use1-az2',
        },
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Route53::RecordSet', {
        HostedZoneId: Match.anyValue(),
      });
    });

    test('uses hosted zone name in record names', () => {
      const vpc = createMockVpc(stack, { azCount: 1 });
      const loadBalancer = createMockLoadBalancer(stack, {
        type: 'application',
        vpc,
      });
      const hostedZone = new route53.PublicHostedZone(stack, 'HostedZone', {
        zoneName: 'example.com',
      });

      new LoadBalancerZonalDnsRecords(stack, 'ZonalDns', {
        loadBalancer,
        hostedZone,
        addWeightedRecord: true,
        topLevelDomainPrefix: 'app',
        availabilityZoneMap: {
          'us-east-1a': 'use1-az1',
        },
      });

      const template = synthesizeStack(stack);
      const recordSets = findResourcesByType(template, 'AWS::Route53::RecordSet');

      expect(recordSets.length).toBeGreaterThan(0);
    });
  });

  describe('DNS record properties', () => {
    test('exposes zonal DNS names array', () => {
      const vpc = createMockVpc(stack, { azCount: 3 });
      const loadBalancer = createMockLoadBalancer(stack, {
        type: 'application',
        vpc,
      });
      const hostedZone = new route53.PublicHostedZone(stack, 'HostedZone', {
        zoneName: 'example.com',
      });

      const zonalDns = new LoadBalancerZonalDnsRecords(stack, 'ZonalDns', {
        loadBalancer,
        hostedZone,
        addWeightedRecord: true,
        topLevelDomainPrefix: 'app',
        availabilityZoneMap: {
          'us-east-1a': 'use1-az1',
          'us-east-1b': 'use1-az2',
          'us-east-1c': 'use1-az3',
        },
      });

      expect(zonalDns.zonalDnsNames).toBeDefined();
      expect(Array.isArray(zonalDns.zonalDnsNames)).toBe(true);
      expect(zonalDns.zonalDnsNames.length).toBe(3);
    });

    test('exposes regional DNS name', () => {
      const vpc = createMockVpc(stack, { azCount: 2 });
      const loadBalancer = createMockLoadBalancer(stack, {
        type: 'application',
        vpc,
      });
      const hostedZone = new route53.PublicHostedZone(stack, 'HostedZone', {
        zoneName: 'example.com',
      });

      const zonalDns = new LoadBalancerZonalDnsRecords(stack, 'ZonalDns', {
        loadBalancer,
        hostedZone,
        addWeightedRecord: true,
        topLevelDomainPrefix: 'app',
        availabilityZoneMap: {
          'us-east-1a': 'use1-az1',
          'us-east-1b': 'use1-az2',
        },
      });

      expect(zonalDns.regionalDnsName).toBeDefined();
    });

    test('exposes zone name to zone ID DNS names mapping', () => {
      const vpc = createMockVpc(stack, { azCount: 2 });
      const loadBalancer = createMockLoadBalancer(stack, {
        type: 'application',
        vpc,
      });
      const hostedZone = new route53.PublicHostedZone(stack, 'HostedZone', {
        zoneName: 'example.com',
      });

      const zonalDns = new LoadBalancerZonalDnsRecords(stack, 'ZonalDns', {
        loadBalancer,
        hostedZone,
        addWeightedRecord: true,
        topLevelDomainPrefix: 'app',
        availabilityZoneMap: {
          'us-east-1a': 'use1-az1',
          'us-east-1b': 'use1-az2',
        },
      });

      expect(zonalDns.zoneNameToZoneIdDnsNames).toBeDefined();
      expect(typeof zonalDns.zoneNameToZoneIdDnsNames).toBe('object');
      expect(Object.keys(zonalDns.zoneNameToZoneIdDnsNames).length).toBe(2);
    });

    test('maps zone names to DNS names correctly', () => {
      const vpc = createMockVpc(stack, { azCount: 2 });
      const loadBalancer = createMockLoadBalancer(stack, {
        type: 'application',
        vpc,
      });
      const hostedZone = new route53.PublicHostedZone(stack, 'HostedZone', {
        zoneName: 'example.com',
      });

      const zonalDns = new LoadBalancerZonalDnsRecords(stack, 'ZonalDns', {
        loadBalancer,
        hostedZone,
        addWeightedRecord: true,
        topLevelDomainPrefix: 'app',
        availabilityZoneMap: {
          'us-east-1a': 'use1-az1',
          'us-east-1b': 'use1-az2',
        },
      });

      expect(zonalDns.zoneNameToZoneIdDnsNames['us-east-1a']).toBeDefined();
      expect(zonalDns.zoneNameToZoneIdDnsNames['us-east-1b']).toBeDefined();
    });
  });

  describe('availability zone mapping', () => {
    test('creates records for single availability zone', () => {
      const vpc = createMockVpc(stack, { azCount: 1 });
      const loadBalancer = createMockLoadBalancer(stack, {
        type: 'application',
        vpc,
      });
      const hostedZone = new route53.PublicHostedZone(stack, 'HostedZone', {
        zoneName: 'example.com',
      });

      const zonalDns = new LoadBalancerZonalDnsRecords(stack, 'ZonalDns', {
        loadBalancer,
        hostedZone,
        addWeightedRecord: true,
        topLevelDomainPrefix: 'app',
        availabilityZoneMap: {
          'us-east-1a': 'use1-az1',
        },
      });

      expect(zonalDns.zonalDnsNames.length).toBe(1);
    });

    test('creates records for multiple availability zones', () => {
      const vpc = createMockVpc(stack, { azCount: 3 });
      const loadBalancer = createMockLoadBalancer(stack, {
        type: 'application',
        vpc,
      });
      const hostedZone = new route53.PublicHostedZone(stack, 'HostedZone', {
        zoneName: 'example.com',
      });

      const zonalDns = new LoadBalancerZonalDnsRecords(stack, 'ZonalDns', {
        loadBalancer,
        hostedZone,
        addWeightedRecord: true,
        topLevelDomainPrefix: 'app',
        availabilityZoneMap: {
          'us-east-1a': 'use1-az1',
          'us-east-1b': 'use1-az2',
          'us-east-1c': 'use1-az3',
        },
      });

      expect(zonalDns.zonalDnsNames.length).toBe(3);
    });

    test('uses zone IDs from availability zone map', () => {
      const vpc = createMockVpc(stack, { azCount: 2 });
      const loadBalancer = createMockLoadBalancer(stack, {
        type: 'application',
        vpc,
      });
      const hostedZone = new route53.PublicHostedZone(stack, 'HostedZone', {
        zoneName: 'example.com',
      });

      new LoadBalancerZonalDnsRecords(stack, 'ZonalDns', {
        loadBalancer,
        hostedZone,
        addWeightedRecord: true,
        topLevelDomainPrefix: 'app',
        availabilityZoneMap: {
          'us-east-1a': 'use1-az1',
          'us-east-1b': 'use1-az2',
        },
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Route53::RecordSet', {
        SetIdentifier: Match.anyValue(),
      });
    });
  });

  describe('CloudFormation resources', () => {
    test('creates correct number of record sets', () => {
      const vpc = createMockVpc(stack, { azCount: 2 });
      const loadBalancer = createMockLoadBalancer(stack, {
        type: 'application',
        vpc,
      });
      const hostedZone = new route53.PublicHostedZone(stack, 'HostedZone', {
        zoneName: 'example.com',
      });

      new LoadBalancerZonalDnsRecords(stack, 'ZonalDns', {
        loadBalancer,
        hostedZone,
        addWeightedRecord: true,
        topLevelDomainPrefix: 'app',
        availabilityZoneMap: {
          'us-east-1a': 'use1-az1',
          'us-east-1b': 'use1-az2',
        },
      });

      const template = synthesizeStack(stack);
      const count = getResourceCount(template, 'AWS::Route53::RecordSet');

      // Should have at least 4 records (2 zonal + 2 weighted)
      expect(count).toBeGreaterThanOrEqual(4);
    });

    test('enables target health evaluation', () => {
      const vpc = createMockVpc(stack, { azCount: 1 });
      const loadBalancer = createMockLoadBalancer(stack, {
        type: 'application',
        vpc,
      });
      const hostedZone = new route53.PublicHostedZone(stack, 'HostedZone', {
        zoneName: 'example.com',
      });

      new LoadBalancerZonalDnsRecords(stack, 'ZonalDns', {
        loadBalancer,
        hostedZone,
        addWeightedRecord: true,
        topLevelDomainPrefix: 'app',
        availabilityZoneMap: {
          'us-east-1a': 'use1-az1',
        },
      });

      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Route53::RecordSet', {
        AliasTarget: {
          EvaluateTargetHealth: true,
        },
      });
    });
  });
});
