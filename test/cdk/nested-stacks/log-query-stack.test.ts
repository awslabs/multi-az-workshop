import { IService } from '@cdklabs/multi-az-observability';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { LogQueryStack } from '../../../src/cdk/lib/nested-stacks/log-query-stack';
import { createService } from '../../../src/cdk/lib/utils/service-factory';
import { createMockVpc, createMockLoadBalancer, createMockLogGroup } from '../../helpers/mock-factories';
import { synthesizeStack, findResourcesByType } from '../../helpers/stack-helpers';

describe('LogQueryStack', () => {
  let app: App;
  let parentStack: Stack;
  let vpc: ec2.Vpc;
  let loadBalancer: elbv2.ILoadBalancerV2;
  let service: IService;
  let serverLogGroup: any;
  let canaryLogGroup: any;
  const availabilityZoneIds = ['use1-az1', 'use1-az2', 'use1-az3'];

  beforeEach(() => {
    app = new App();
    parentStack = new Stack(app, 'ParentStack', {
      env: { region: 'us-east-1', account: '123456789012' },
    });
    vpc = createMockVpc(parentStack, { azCount: 3 });
    loadBalancer = createMockLoadBalancer(parentStack, { type: 'application', vpc });
    serverLogGroup = createMockLogGroup(parentStack, 'ServerLogGroup');
    canaryLogGroup = createMockLogGroup(parentStack, 'CanaryLogGroup');
    service = createService({
      loadBalancer,
      vpc,
      serverLogGroups: [serverLogGroup],
    });
  });

  describe('stack creation', () => {
    test('synthesizes without errors', () => {
      const logQueryStack = new LogQueryStack(parentStack, 'LogQueryStack', {
        serverSideLogGroup: serverLogGroup,
        service,
        availabilityZoneIds,
      });
      expect(() => synthesizeStack(logQueryStack)).not.toThrow();
    });

    test('creates nested stack resource', () => {
      new LogQueryStack(parentStack, 'LogQueryStack', {
        serverSideLogGroup: serverLogGroup,
        service,
        availabilityZoneIds,
      });
      const template = Template.fromStack(parentStack);
      template.resourceCountIs('AWS::CloudFormation::Stack', 1);
    });
  });

  describe('CloudWatch Insights query creation', () => {
    test('creates query definitions for server-side logs', () => {
      const logQueryStack = new LogQueryStack(parentStack, 'LogQueryStack', {
        serverSideLogGroup: serverLogGroup,
        service,
        availabilityZoneIds,
      });
      const template = Template.fromStack(logQueryStack);

      // Should create queries for each operation (4 operations in service)
      // Each operation gets: regional requests, regional high latency, regional faults
      // Plus per-AZ: requests, high latency, faults (3 queries * 3 AZs = 9)
      // Total per operation: 3 regional + 9 per-AZ = 12 queries
      // Total for 4 operations: 48 queries
      const queryDefinitions = findResourcesByType(template, 'AWS::Logs::QueryDefinition');
      expect(queryDefinitions.length).toBeGreaterThan(0);
    });

    test('creates query definitions for canary logs when provided', () => {
      const logQueryStack = new LogQueryStack(parentStack, 'LogQueryStack', {
        serverSideLogGroup: serverLogGroup,
        canaryLogGroup,
        service,
        availabilityZoneIds,
      });
      const template = Template.fromStack(logQueryStack);

      // Should create queries for both server and canary logs
      const queryDefinitions = findResourcesByType(template, 'AWS::Logs::QueryDefinition');
      expect(queryDefinitions.length).toBeGreaterThan(0);
    });

    test('does not create canary queries when canary log group is not provided', () => {
      const logQueryStack = new LogQueryStack(parentStack, 'LogQueryStack', {
        serverSideLogGroup: serverLogGroup,
        service,
        availabilityZoneIds,
      });
      const template = Template.fromStack(logQueryStack);

      // Verify no canary-specific queries exist
      const queryDefinitions = findResourcesByType(template, 'AWS::Logs::QueryDefinition');
      const canaryQueries = queryDefinitions.filter((q: any) =>
        q.Properties?.QueryDefinitionName?.['Fn::Sub']?.[0]?.includes('-canary'),
      );
      expect(canaryQueries.length).toBe(0);
    });
  });

  describe('query configuration for operations', () => {
    test('creates queries for each operation in the service', () => {
      const logQueryStack = new LogQueryStack(parentStack, 'LogQueryStack', {
        serverSideLogGroup: serverLogGroup,
        service,
        availabilityZoneIds,
      });
      const template = Template.fromStack(logQueryStack);

      // Service has 4 operations: Signin, Pay, Ride, Home
      // Each operation gets 3 regional queries + 9 per-AZ queries = 12 queries per operation
      // Total: 4 operations * 12 queries = 48 queries
      const queryDefinitions = findResourcesByType(template, 'AWS::Logs::QueryDefinition');
      expect(queryDefinitions.length).toBe(48);
    });

    test('creates multiple query types per operation', () => {
      const logQueryStack = new LogQueryStack(parentStack, 'LogQueryStack', {
        serverSideLogGroup: serverLogGroup,
        service,
        availabilityZoneIds,
      });
      const template = Template.fromStack(logQueryStack);

      const queryDefinitions = findResourcesByType(template, 'AWS::Logs::QueryDefinition');

      // Verify queries contain operation filters
      const queriesWithOperationFilter = queryDefinitions.filter((q: any) => {
        const queryString = q.Properties?.QueryString;
        return queryString && queryString.includes('Operation =');
      });
      expect(queriesWithOperationFilter.length).toBeGreaterThan(0);
    });

    test('creates queries with different filter types', () => {
      const logQueryStack = new LogQueryStack(parentStack, 'LogQueryStack', {
        serverSideLogGroup: serverLogGroup,
        service,
        availabilityZoneIds,
      });
      const template = Template.fromStack(logQueryStack);

      const queryDefinitions = findResourcesByType(template, 'AWS::Logs::QueryDefinition');

      // Check for high latency queries
      const highLatencyQueries = queryDefinitions.filter((q: any) => {
        const queryString = q.Properties?.QueryString;
        return queryString && queryString.includes('SuccessLatency >');
      });
      expect(highLatencyQueries.length).toBeGreaterThan(0);

      // Check for fault queries
      const faultQueries = queryDefinitions.filter((q: any) => {
        const queryString = q.Properties?.QueryString;
        return queryString && queryString.includes('Fault = 1 or Failure = 1');
      });
      expect(faultQueries.length).toBeGreaterThan(0);
    });

    test('creates per-AZ queries with AZ-ID filters', () => {
      const logQueryStack = new LogQueryStack(parentStack, 'LogQueryStack', {
        serverSideLogGroup: serverLogGroup,
        service,
        availabilityZoneIds,
      });
      const template = Template.fromStack(logQueryStack);

      const queryDefinitions = findResourcesByType(template, 'AWS::Logs::QueryDefinition');

      // Check that queries with AZ-ID filters exist
      const azQueries = queryDefinitions.filter((q: any) => {
        const queryString = q.Properties?.QueryString;
        return queryString && queryString.includes('`AZ-ID` =');
      });

      // Should have 3 query types * 3 AZs * 4 operations = 36 AZ-specific queries
      expect(azQueries.length).toBe(36);
    });
  });

  describe('log group integration', () => {
    test('associates queries with server log group', () => {
      const logQueryStack = new LogQueryStack(parentStack, 'LogQueryStack', {
        serverSideLogGroup: serverLogGroup,
        service,
        availabilityZoneIds,
      });
      const template = Template.fromStack(logQueryStack);

      const queryDefinitions = findResourcesByType(template, 'AWS::Logs::QueryDefinition');
      expect(queryDefinitions.length).toBeGreaterThan(0);

      // Verify queries reference log groups
      for (const query of queryDefinitions) {
        expect(query.Properties.LogGroupNames).toBeDefined();
        expect(Array.isArray(query.Properties.LogGroupNames)).toBe(true);
      }
    });

    test('associates canary queries with canary log group when provided', () => {
      const logQueryStack = new LogQueryStack(parentStack, 'LogQueryStack', {
        serverSideLogGroup: serverLogGroup,
        canaryLogGroup,
        service,
        availabilityZoneIds,
      });
      const template = Template.fromStack(logQueryStack);

      const queryDefinitions = findResourcesByType(template, 'AWS::Logs::QueryDefinition');

      // With canary log group, should have double the queries (48 server + 48 canary = 96)
      expect(queryDefinitions.length).toBe(96);

      // Verify all queries reference log groups
      for (const query of queryDefinitions) {
        expect(query.Properties.LogGroupNames).toBeDefined();
      }
    });
  });

  describe('stack parameters', () => {
    test('accepts required parameters', () => {
      expect(() => {
        new LogQueryStack(parentStack, 'LogQueryStack', {
          serverSideLogGroup: serverLogGroup,
          service,
          availabilityZoneIds,
        });
      }).not.toThrow();
    });

    test('accepts optional canary log group parameter', () => {
      expect(() => {
        new LogQueryStack(parentStack, 'LogQueryStack', {
          serverSideLogGroup: serverLogGroup,
          canaryLogGroup,
          service,
          availabilityZoneIds,
        });
      }).not.toThrow();
    });
  });

  describe('query definitions', () => {
    test('query definitions have correct structure', () => {
      const logQueryStack = new LogQueryStack(parentStack, 'LogQueryStack', {
        serverSideLogGroup: serverLogGroup,
        service,
        availabilityZoneIds,
      });
      const template = Template.fromStack(logQueryStack);

      const queryDefinitions = findResourcesByType(template, 'AWS::Logs::QueryDefinition');
      expect(queryDefinitions.length).toBeGreaterThan(0);

      // Verify each query has required properties
      for (const query of queryDefinitions) {
        expect(query.Properties).toBeDefined();
        expect(query.Properties.QueryString).toBeDefined();
        expect(query.Properties.LogGroupNames).toBeDefined();
      }
    });

    test('query strings contain operation filters', () => {
      const logQueryStack = new LogQueryStack(parentStack, 'LogQueryStack', {
        serverSideLogGroup: serverLogGroup,
        service,
        availabilityZoneIds,
      });
      const template = Template.fromStack(logQueryStack);

      const queryDefinitions = findResourcesByType(template, 'AWS::Logs::QueryDefinition');

      // Check that queries filter by operation name
      const operations = ['Signin', 'Pay', 'Ride', 'Home'];
      for (const operation of operations) {
        const operationQueries = queryDefinitions.filter((q: any) => {
          const queryString = q.Properties?.QueryString;
          return queryString && queryString.includes(`Operation = "${operation}"`);
        });
        expect(operationQueries.length).toBeGreaterThan(0);
      }
    });

    test('high latency queries include latency threshold filter', () => {
      const logQueryStack = new LogQueryStack(parentStack, 'LogQueryStack', {
        serverSideLogGroup: serverLogGroup,
        service,
        availabilityZoneIds,
      });
      const template = Template.fromStack(logQueryStack);

      const queryDefinitions = findResourcesByType(template, 'AWS::Logs::QueryDefinition');
      const highLatencyQueries = queryDefinitions.filter((q: any) => {
        const queryString = q.Properties?.QueryString;
        return queryString && queryString.includes('SuccessLatency >');
      });

      // Should have 1 regional + 3 AZ queries per operation * 4 operations = 16 high latency queries
      expect(highLatencyQueries.length).toBe(16);

      // Verify high latency queries include threshold filter
      for (const query of highLatencyQueries) {
        const queryString = query.Properties.QueryString;
        expect(queryString).toContain('SuccessLatency >');
      }
    });

    test('fault queries include fault filter', () => {
      const logQueryStack = new LogQueryStack(parentStack, 'LogQueryStack', {
        serverSideLogGroup: serverLogGroup,
        service,
        availabilityZoneIds,
      });
      const template = Template.fromStack(logQueryStack);

      const queryDefinitions = findResourcesByType(template, 'AWS::Logs::QueryDefinition');
      const faultQueries = queryDefinitions.filter((q: any) => {
        const queryString = q.Properties?.QueryString;
        return queryString && queryString.includes('Fault = 1 or Failure = 1');
      });

      // Should have 1 regional + 3 AZ queries per operation * 4 operations = 16 fault queries
      expect(faultQueries.length).toBe(16);

      // Verify fault queries include fault filter
      for (const query of faultQueries) {
        const queryString = query.Properties.QueryString;
        expect(queryString).toContain('Fault = 1 or Failure = 1');
      }
    });

    test('per-AZ queries include AZ-ID filter', () => {
      const logQueryStack = new LogQueryStack(parentStack, 'LogQueryStack', {
        serverSideLogGroup: serverLogGroup,
        service,
        availabilityZoneIds,
      });
      const template = Template.fromStack(logQueryStack);

      const queryDefinitions = findResourcesByType(template, 'AWS::Logs::QueryDefinition');

      // Check queries for each AZ
      for (const azId of availabilityZoneIds) {
        const azQueries = queryDefinitions.filter((q: any) => {
          const queryString = q.Properties?.QueryString;
          return queryString && queryString.includes(`\`AZ-ID\` = "${azId}"`);
        });

        // Each AZ should have 3 query types * 4 operations = 12 queries
        expect(azQueries.length).toBe(12);

        // Verify AZ queries include AZ-ID filter
        for (const query of azQueries) {
          const queryString = query.Properties.QueryString;
          expect(queryString).toContain(`\`AZ-ID\` = "${azId}"`);
        }
      }
    });
  });
});
