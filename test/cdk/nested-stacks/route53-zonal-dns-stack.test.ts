import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Route53ZonalDnsStack } from '../../../src/cdk/lib/nested-stacks/route53-zonal-dns-stack';
import { createMockVpc, createMockLoadBalancer } from '../../helpers/mock-factories';
import { synthesizeStack, findResourcesByType } from '../../helpers/stack-helpers';

describe('Route53ZonalDnsStack', () => {
  let app: App;
  let parentStack: Stack;
  let vpc: ec2.Vpc;
  let loadBalancer: elbv2.ILoadBalancerV2;
  let availabilityZoneMap: Record<string, string>;

  beforeEach(() => {
    app = new App();
    parentStack = new Stack(app, 'ParentStack', {
      env: { region: 'us-east-1', account: '123456789012' },
    });
    vpc = createMockVpc(parentStack, { azCount: 3 });
    loadBalancer = createMockLoadBalancer(parentStack, { type: 'application', vpc });

    // Map AZ names to AZ IDs
    availabilityZoneMap = {
      'us-east-1a': 'use1-az1',
      'us-east-1b': 'use1-az2',
      'us-east-1c': 'use1-az3',
    };
  });

  describe('stack creation', () => {
    test('synthesizes without errors', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStack', {
        vpc,
        loadBalancer,
        availabilityZoneMap,
      });
      expect(() => synthesizeStack(dnsStack)).not.toThrow();
    });

    test('synthesizes without errors with custom domain', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStack', {
        vpc,
        domain: 'custom.example.com',
        loadBalancer,
        availabilityZoneMap,
      });
      expect(() => synthesizeStack(dnsStack)).not.toThrow();
    });

    test('creates nested stack resource', () => {
      new Route53ZonalDnsStack(parentStack, 'DnsStack', {
        vpc,
        loadBalancer,
        availabilityZoneMap,
      });
      const template = Template.fromStack(parentStack);
      template.resourceCountIs('AWS::CloudFormation::Stack', 1);
    });
  });

  describe('Route53 hosted zone creation', () => {
    test('creates private hosted zone', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStack', {
        vpc,
        loadBalancer,
        availabilityZoneMap,
      });
      const template = Template.fromStack(dnsStack);

      template.resourceCountIs('AWS::Route53::HostedZone', 1);
    });

    test('creates private hosted zone with default domain', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStack', {
        vpc,
        loadBalancer,
        availabilityZoneMap,
      });
      const template = Template.fromStack(dnsStack);

      template.hasResourceProperties('AWS::Route53::HostedZone', {
        Name: 'example.com.',
      });
    });

    test('creates private hosted zone with custom domain', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStack', {
        vpc,
        domain: 'custom.example.com',
        loadBalancer,
        availabilityZoneMap,
      });
      const template = Template.fromStack(dnsStack);

      template.hasResourceProperties('AWS::Route53::HostedZone', {
        Name: 'custom.example.com.',
      });
    });

    test('associates hosted zone with VPC', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStack', {
        vpc,
        loadBalancer,
        availabilityZoneMap,
      });
      const template = Template.fromStack(dnsStack);

      template.hasResourceProperties('AWS::Route53::HostedZone', {
        VPCs: Match.arrayWith([
          Match.objectLike({
            VPCId: Match.anyValue(),
            VPCRegion: 'us-east-1',
          }),
        ]),
      });
    });

    test('exposes hosted zone as public property', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStack', {
        vpc,
        loadBalancer,
        availabilityZoneMap,
      });

      expect(dnsStack.hostedZone).toBeDefined();
      expect(dnsStack.hostedZone.zoneName).toBeDefined();
    });
  });

  describe('DNS record creation for zones', () => {
    test('creates zonal DNS records for load balancer', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStack', {
        vpc,
        loadBalancer,
        availabilityZoneMap,
      });
      const template = Template.fromStack(dnsStack);

      // Should create records for each AZ
      const recordSets = findResourcesByType(template, 'AWS::Route53::RecordSet');
      expect(recordSets.length).toBeGreaterThan(0);
    });

    test('creates A records for IPv4', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStack', {
        vpc,
        loadBalancer,
        availabilityZoneMap,
      });
      const template = Template.fromStack(dnsStack);

      template.hasResourceProperties('AWS::Route53::RecordSet', {
        Type: 'A',
      });
    });

    test('creates alias records pointing to load balancer', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStack', {
        vpc,
        loadBalancer,
        availabilityZoneMap,
      });
      const template = Template.fromStack(dnsStack);

      const recordSets = findResourcesByType(template, 'AWS::Route53::RecordSet');
      const aliasRecords = recordSets.filter((r: any) => r.Properties.AliasTarget);
      expect(aliasRecords.length).toBeGreaterThan(0);
    });

    test('associates records with hosted zone', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStack', {
        vpc,
        loadBalancer,
        availabilityZoneMap,
      });
      const template = Template.fromStack(dnsStack);

      const recordSets = findResourcesByType(template, 'AWS::Route53::RecordSet');
      for (const recordSet of recordSets) {
        expect(recordSet.Properties.HostedZoneId).toBeDefined();
      }
    });
  });

  describe('record configuration', () => {
    test('creates records with www prefix', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStack', {
        vpc,
        domain: 'example.com',
        loadBalancer,
        availabilityZoneMap,
      });
      const template = Template.fromStack(dnsStack);

      const recordSets = findResourcesByType(template, 'AWS::Route53::RecordSet');
      const wwwRecords = recordSets.filter((r: any) => {
        const name = r.Properties.Name;
        return name && (name.includes('www') || name['Fn::Join']);
      });
      expect(wwwRecords.length).toBeGreaterThan(0);
    });

    test('creates weighted records when enabled', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStack', {
        vpc,
        loadBalancer,
        availabilityZoneMap,
      });
      const template = Template.fromStack(dnsStack);

      // LoadBalancerZonalDnsRecords creates weighted records by default
      const recordSets = findResourcesByType(template, 'AWS::Route53::RecordSet');
      const weightedRecords = recordSets.filter((r: any) => r.Properties.Weight !== undefined);
      expect(weightedRecords.length).toBeGreaterThan(0);
    });

    test('creates records for each availability zone', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStack', {
        vpc,
        loadBalancer,
        availabilityZoneMap,
      });

      // Verify zonal DNS names are created
      expect(dnsStack.frontEndZonalDnsNames).toBeDefined();
      expect(Array.isArray(dnsStack.frontEndZonalDnsNames)).toBe(true);
      expect(dnsStack.frontEndZonalDnsNames.length).toBe(Object.keys(availabilityZoneMap).length);
    });
  });

  describe('stack parameters and outputs', () => {
    test('accepts required parameters', () => {
      expect(() => {
        new Route53ZonalDnsStack(parentStack, 'DnsStack', {
          vpc,
          loadBalancer,
          availabilityZoneMap,
        });
      }).not.toThrow();
    });

    test('accepts optional domain parameter', () => {
      expect(() => {
        new Route53ZonalDnsStack(parentStack, 'DnsStack', {
          vpc,
          domain: 'test.example.com',
          loadBalancer,
          availabilityZoneMap,
        });
      }).not.toThrow();
    });

    test('exposes zonal DNS names', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStack', {
        vpc,
        loadBalancer,
        availabilityZoneMap,
      });

      expect(dnsStack.frontEndZonalDnsNames).toBeDefined();
      expect(Array.isArray(dnsStack.frontEndZonalDnsNames)).toBe(true);
      expect(dnsStack.frontEndZonalDnsNames.length).toBeGreaterThan(0);
    });

    test('exposes regional DNS name', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStack', {
        vpc,
        domain: 'example.com',
        loadBalancer,
        availabilityZoneMap,
      });

      expect(dnsStack.frontEndRegionalDnsName).toBeDefined();
      expect(dnsStack.frontEndRegionalDnsName).toContain('www');
      expect(dnsStack.frontEndRegionalDnsName).toContain('example.com');
    });

    test('regional DNS name includes trailing dot', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStack', {
        vpc,
        domain: 'example.com',
        loadBalancer,
        availabilityZoneMap,
      });

      expect(dnsStack.frontEndRegionalDnsName).toMatch(/\.$/);
    });
  });

  describe('DNS resources', () => {
    test('creates all required resource types', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStack', {
        vpc,
        loadBalancer,
        availabilityZoneMap,
      });
      const template = Template.fromStack(dnsStack);

      template.resourceCountIs('AWS::Route53::HostedZone', 1);
      const recordSets = findResourcesByType(template, 'AWS::Route53::RecordSet');
      expect(recordSets.length).toBeGreaterThan(0);
    });

    test('hosted zone has correct resource type', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStack', {
        vpc,
        loadBalancer,
        availabilityZoneMap,
      });
      const template = Template.fromStack(dnsStack);

      const hostedZones = findResourcesByType(template, 'AWS::Route53::HostedZone');
      expect(hostedZones.length).toBe(1);
      expect(hostedZones[0].Type).toBe('AWS::Route53::HostedZone');
    });

    test('record sets have correct resource type', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStack', {
        vpc,
        loadBalancer,
        availabilityZoneMap,
      });
      const template = Template.fromStack(dnsStack);

      const recordSets = findResourcesByType(template, 'AWS::Route53::RecordSet');
      for (const recordSet of recordSets) {
        expect(recordSet.Type).toBe('AWS::Route53::RecordSet');
      }
    });
  });

  describe('domain name handling', () => {
    test('creates hosted zone with provided domain', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStackDomain1', {
        vpc,
        domain: 'example.com',
        loadBalancer,
        availabilityZoneMap,
      });

      expect(dnsStack.hostedZone.zoneName).toContain('example.com');
    });

    test('creates hosted zone with domain including trailing dot', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStackDomain2', {
        vpc,
        domain: 'example.com.',
        loadBalancer,
        availabilityZoneMap,
      });

      expect(dnsStack.hostedZone.zoneName).toContain('example.com');
    });

    test('uses default domain when not provided', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStackDomain3', {
        vpc,
        loadBalancer,
        availabilityZoneMap,
      });

      expect(dnsStack.hostedZone.zoneName).toContain('example.com');
    });
  });

  describe('load balancer integration', () => {
    test('creates DNS records for application load balancer', () => {
      const alb = createMockLoadBalancer(parentStack, {
        type: 'application',
        vpc,
        loadBalancerName: 'TestALB',
      });
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStackALB', {
        vpc,
        loadBalancer: alb,
        availabilityZoneMap,
      });
      const template = Template.fromStack(dnsStack);

      const recordSets = findResourcesByType(template, 'AWS::Route53::RecordSet');
      expect(recordSets.length).toBeGreaterThan(0);
    });

    test('creates DNS records for network load balancer', () => {
      const nlb = createMockLoadBalancer(parentStack, {
        type: 'network',
        vpc,
        loadBalancerName: 'TestNLB',
      });
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStackNLB', {
        vpc,
        loadBalancer: nlb,
        availabilityZoneMap,
      });
      const template = Template.fromStack(dnsStack);

      const recordSets = findResourcesByType(template, 'AWS::Route53::RecordSet');
      expect(recordSets.length).toBeGreaterThan(0);
    });

    test('alias records reference load balancer', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStack', {
        vpc,
        loadBalancer,
        availabilityZoneMap,
      });
      const template = Template.fromStack(dnsStack);

      const recordSets = findResourcesByType(template, 'AWS::Route53::RecordSet');
      const aliasRecords = recordSets.filter((r: any) => r.Properties.AliasTarget);

      expect(aliasRecords.length).toBeGreaterThan(0);

      // Verify alias targets have required properties
      for (const record of aliasRecords) {
        expect(record.Properties.AliasTarget.DNSName).toBeDefined();
        expect(record.Properties.AliasTarget.HostedZoneId).toBeDefined();
      }
    });
  });

  describe('availability zone mapping', () => {
    test('uses provided availability zone map', () => {
      const customAzMap = {
        'us-west-2a': 'usw2-az1',
        'us-west-2b': 'usw2-az2',
      };

      const customLb = createMockLoadBalancer(parentStack, {
        type: 'application',
        vpc,
        loadBalancerName: 'CustomAzMapLB',
      });

      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStackCustomAz', {
        vpc,
        loadBalancer: customLb,
        availabilityZoneMap: customAzMap,
      });

      expect(dnsStack.frontEndZonalDnsNames.length).toBe(Object.keys(customAzMap).length);
    });

    test('creates records for all zones in map', () => {
      const dnsStack = new Route53ZonalDnsStack(parentStack, 'DnsStackAllZones', {
        vpc,
        loadBalancer,
        availabilityZoneMap,
      });

      const zonalDnsNames = dnsStack.frontEndZonalDnsNames;
      expect(zonalDnsNames.length).toBe(Object.keys(availabilityZoneMap).length);
    });
  });
});
