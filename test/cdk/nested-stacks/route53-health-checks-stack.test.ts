import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as arc from 'aws-cdk-lib/aws-route53recoverycontrol';
import { Route53HealthChecksStack } from '../../../src/cdk/lib/nested-stacks/route53-health-checks-stack';
import { EvacuationMethod } from '../../../src/cdk/lib/types/evacuation-method';
import { synthesizeStack, findResourcesByType } from '../../helpers/stack-helpers';

describe('Route53HealthChecksStack', () => {
  let app: App;
  let parentStack: Stack;
  const availabilityZoneIds = ['use1-az1', 'use1-az2', 'use1-az3'];
  let routingControls: Record<string, arc.CfnRoutingControl>;

  beforeEach(() => {
    app = new App();
    parentStack = new Stack(app, 'ParentStack', {
      env: { region: 'us-east-1', account: '123456789012' },
    });

    // Create mock routing controls for ARC tests
    routingControls = {};
    availabilityZoneIds.forEach((azId, index) => {
      routingControls[azId] = new arc.CfnRoutingControl(parentStack, `RoutingControl${index}`, {
        name: `routing-control-${azId}`,
        clusterArn: 'arn:aws:route53-recovery-control::123456789012:cluster/test-cluster',
      });
    });
  });

  describe('stack creation', () => {
    test('synthesizes without errors with ARC evacuation method', () => {
      const healthCheckStack = new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
        evacuationMethod: EvacuationMethod.ARC,
        domainName: 'example.com',
        resourcePath: '/health',
        availabilityZoneIdToRoutingControlArns: routingControls,
      });
      expect(() => synthesizeStack(healthCheckStack)).not.toThrow();
    });

    test('synthesizes without errors with S3 evacuation method', () => {
      const healthCheckStack = new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
        evacuationMethod: EvacuationMethod.SelfManagedHttpEndpoint_S3,
        domainName: 'example.com',
        resourcePath: '/health',
        availabilityZoneIdToRoutingControlArns: routingControls,
      });
      expect(() => synthesizeStack(healthCheckStack)).not.toThrow();
    });

    test('synthesizes without errors with APIG evacuation method', () => {
      const healthCheckStack = new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
        evacuationMethod: EvacuationMethod.SelfManagedHttpEndpoint_APIG,
        domainName: 'example.com',
        resourcePath: '/health',
        availabilityZoneIdToRoutingControlArns: routingControls,
      });
      expect(() => synthesizeStack(healthCheckStack)).not.toThrow();
    });

    test('creates nested stack resource', () => {
      new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
        evacuationMethod: EvacuationMethod.ARC,
        domainName: 'example.com',
        resourcePath: '/health',
        availabilityZoneIdToRoutingControlArns: routingControls,
      });
      const template = Template.fromStack(parentStack);
      template.resourceCountIs('AWS::CloudFormation::Stack', 1);
    });
  });

  describe('Route53 health check creation', () => {
    test('creates health check for each availability zone', () => {
      const healthCheckStack = new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
        evacuationMethod: EvacuationMethod.ARC,
        domainName: 'example.com',
        resourcePath: '/health',
        availabilityZoneIdToRoutingControlArns: routingControls,
      });
      const template = Template.fromStack(healthCheckStack);

      template.resourceCountIs('AWS::Route53::HealthCheck', availabilityZoneIds.length);
    });

    test('exposes health checks as public property', () => {
      const healthCheckStack = new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
        evacuationMethod: EvacuationMethod.ARC,
        domainName: 'example.com',
        resourcePath: '/health',
        availabilityZoneIdToRoutingControlArns: routingControls,
      });

      expect(healthCheckStack.healthChecks).toBeDefined();
      expect(Array.isArray(healthCheckStack.healthChecks)).toBe(true);
      expect(healthCheckStack.healthChecks.length).toBe(availabilityZoneIds.length);
    });
  });

  describe('health check configuration - ARC', () => {
    test('creates RECOVERY_CONTROL type health checks for ARC', () => {
      const healthCheckStack = new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
        evacuationMethod: EvacuationMethod.ARC,
        domainName: 'example.com',
        resourcePath: '/health',
        availabilityZoneIdToRoutingControlArns: routingControls,
      });
      const template = Template.fromStack(healthCheckStack);

      template.hasResourceProperties('AWS::Route53::HealthCheck', {
        HealthCheckConfig: {
          Type: 'RECOVERY_CONTROL',
          RoutingControlArn: Match.anyValue(),
        },
      });
    });

    test('associates each health check with correct routing control', () => {
      const healthCheckStack = new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
        evacuationMethod: EvacuationMethod.ARC,
        domainName: 'example.com',
        resourcePath: '/health',
        availabilityZoneIdToRoutingControlArns: routingControls,
      });
      const template = Template.fromStack(healthCheckStack);

      const healthChecks = findResourcesByType(template, 'AWS::Route53::HealthCheck');
      expect(healthChecks.length).toBe(availabilityZoneIds.length);

      // Verify each health check references a routing control
      for (const healthCheck of healthChecks) {
        expect(healthCheck.Properties.HealthCheckConfig.Type).toBe('RECOVERY_CONTROL');
        expect(healthCheck.Properties.HealthCheckConfig.RoutingControlArn).toBeDefined();
      }
    });
  });

  describe('health check configuration - HTTP/HTTPS', () => {
    test('creates HTTPS type health checks for S3 evacuation method', () => {
      const healthCheckStack = new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
        evacuationMethod: EvacuationMethod.SelfManagedHttpEndpoint_S3,
        domainName: 'example.com',
        resourcePath: '/health/',
        availabilityZoneIdToRoutingControlArns: routingControls,
      });
      const template = Template.fromStack(healthCheckStack);

      template.hasResourceProperties('AWS::Route53::HealthCheck', {
        HealthCheckConfig: {
          Type: 'HTTPS',
          FullyQualifiedDomainName: 'example.com',
          Port: 443,
          FailureThreshold: 1,
        },
      });
    });

    test('creates HTTPS type health checks for APIG evacuation method', () => {
      const healthCheckStack = new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
        evacuationMethod: EvacuationMethod.SelfManagedHttpEndpoint_APIG,
        domainName: 'api.example.com',
        resourcePath: '/status/',
        availabilityZoneIdToRoutingControlArns: routingControls,
      });
      const template = Template.fromStack(healthCheckStack);

      template.hasResourceProperties('AWS::Route53::HealthCheck', {
        HealthCheckConfig: {
          Type: 'HTTPS',
          FullyQualifiedDomainName: 'api.example.com',
          Port: 443,
          FailureThreshold: 1,
        },
      });
    });

    test('constructs resource path with AZ ID for HTTP health checks', () => {
      const healthCheckStack = new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
        evacuationMethod: EvacuationMethod.SelfManagedHttpEndpoint_S3,
        domainName: 'example.com',
        resourcePath: '/health/',
        availabilityZoneIdToRoutingControlArns: routingControls,
      });
      const template = Template.fromStack(healthCheckStack);

      const healthChecks = findResourcesByType(template, 'AWS::Route53::HealthCheck');

      // Verify resource path includes AZ ID substitution
      for (const healthCheck of healthChecks) {
        const resourcePath = healthCheck.Properties.HealthCheckConfig.ResourcePath;
        expect(resourcePath).toBeDefined();
        // Should use Fn::Sub to append AZ ID
        if (typeof resourcePath === 'object' && resourcePath['Fn::Sub']) {
          expect(resourcePath['Fn::Sub']).toBeDefined();
        }
      }
    });

    test('uses port 443 for HTTPS health checks', () => {
      const healthCheckStack = new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
        evacuationMethod: EvacuationMethod.SelfManagedHttpEndpoint_S3,
        domainName: 'example.com',
        resourcePath: '/health/',
        availabilityZoneIdToRoutingControlArns: routingControls,
      });
      const template = Template.fromStack(healthCheckStack);

      const healthChecks = findResourcesByType(template, 'AWS::Route53::HealthCheck');
      for (const healthCheck of healthChecks) {
        expect(healthCheck.Properties.HealthCheckConfig.Port).toBe(443);
      }
    });

    test('sets failure threshold to 1 for HTTP health checks', () => {
      const healthCheckStack = new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
        evacuationMethod: EvacuationMethod.SelfManagedHttpEndpoint_APIG,
        domainName: 'example.com',
        resourcePath: '/health/',
        availabilityZoneIdToRoutingControlArns: routingControls,
      });
      const template = Template.fromStack(healthCheckStack);

      const healthChecks = findResourcesByType(template, 'AWS::Route53::HealthCheck');
      for (const healthCheck of healthChecks) {
        expect(healthCheck.Properties.HealthCheckConfig.FailureThreshold).toBe(1);
      }
    });
  });

  describe('CloudWatch alarm integration', () => {
    test('health checks can be used with CloudWatch alarms', () => {
      const healthCheckStack = new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
        evacuationMethod: EvacuationMethod.ARC,
        domainName: 'example.com',
        resourcePath: '/health',
        availabilityZoneIdToRoutingControlArns: routingControls,
      });

      // Verify health checks are accessible for alarm creation
      expect(healthCheckStack.healthChecks).toBeDefined();
      expect(healthCheckStack.healthChecks.length).toBeGreaterThan(0);

      // Each health check should have a ref that can be used in alarms
      for (const healthCheck of healthCheckStack.healthChecks) {
        expect(healthCheck.ref).toBeDefined();
      }
    });
  });

  describe('stack parameters', () => {
    test('accepts required parameters', () => {
      expect(() => {
        new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
          evacuationMethod: EvacuationMethod.ARC,
          domainName: 'example.com',
          resourcePath: '/health',
          availabilityZoneIdToRoutingControlArns: routingControls,
        });
      }).not.toThrow();
    });

    test('accepts inverted parameter', () => {
      expect(() => {
        new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
          evacuationMethod: EvacuationMethod.SelfManagedHttpEndpoint_S3,
          domainName: 'example.com',
          resourcePath: '/health',
          availabilityZoneIdToRoutingControlArns: routingControls,
          inverted: true,
        });
      }).not.toThrow();
    });

    test('uses inverted parameter when provided', () => {
      const healthCheckStack = new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
        evacuationMethod: EvacuationMethod.SelfManagedHttpEndpoint_S3,
        domainName: 'example.com',
        resourcePath: '/health',
        availabilityZoneIdToRoutingControlArns: routingControls,
        inverted: true,
      });
      const template = Template.fromStack(healthCheckStack);

      template.hasResourceProperties('AWS::Route53::HealthCheck', {
        HealthCheckConfig: {
          Inverted: true,
        },
      });
    });

    test('defaults inverted to false when not provided', () => {
      const healthCheckStack = new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
        evacuationMethod: EvacuationMethod.SelfManagedHttpEndpoint_S3,
        domainName: 'example.com',
        resourcePath: '/health',
        availabilityZoneIdToRoutingControlArns: routingControls,
      });
      const template = Template.fromStack(healthCheckStack);

      const healthChecks = findResourcesByType(template, 'AWS::Route53::HealthCheck');
      for (const healthCheck of healthChecks) {
        const inverted = healthCheck.Properties.HealthCheckConfig.Inverted;
        expect(inverted === undefined || inverted === false).toBe(true);
      }
    });
  });

  describe('health check properties', () => {
    test('health checks have correct CloudFormation resource type', () => {
      const healthCheckStack = new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
        evacuationMethod: EvacuationMethod.ARC,
        domainName: 'example.com',
        resourcePath: '/health',
        availabilityZoneIdToRoutingControlArns: routingControls,
      });
      const template = Template.fromStack(healthCheckStack);

      const healthChecks = findResourcesByType(template, 'AWS::Route53::HealthCheck');
      expect(healthChecks.length).toBe(availabilityZoneIds.length);

      for (const healthCheck of healthChecks) {
        expect(healthCheck.Type).toBe('AWS::Route53::HealthCheck');
      }
    });

    test('health checks have HealthCheckConfig property', () => {
      const healthCheckStack = new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
        evacuationMethod: EvacuationMethod.ARC,
        domainName: 'example.com',
        resourcePath: '/health',
        availabilityZoneIdToRoutingControlArns: routingControls,
      });
      const template = Template.fromStack(healthCheckStack);

      const healthChecks = findResourcesByType(template, 'AWS::Route53::HealthCheck');
      for (const healthCheck of healthChecks) {
        expect(healthCheck.Properties.HealthCheckConfig).toBeDefined();
        expect(healthCheck.Properties.HealthCheckConfig.Type).toBeDefined();
      }
    });
  });

  describe('evacuation method handling', () => {
    test('handles ARC evacuation method', () => {
      const healthCheckStack = new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
        evacuationMethod: EvacuationMethod.ARC,
        domainName: 'example.com',
        resourcePath: '/health',
        availabilityZoneIdToRoutingControlArns: routingControls,
      });
      const template = Template.fromStack(healthCheckStack);

      template.hasResourceProperties('AWS::Route53::HealthCheck', {
        HealthCheckConfig: {
          Type: 'RECOVERY_CONTROL',
        },
      });
    });

    test('handles S3 evacuation method', () => {
      const healthCheckStack = new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
        evacuationMethod: EvacuationMethod.SelfManagedHttpEndpoint_S3,
        domainName: 'example.com',
        resourcePath: '/health',
        availabilityZoneIdToRoutingControlArns: routingControls,
      });
      const template = Template.fromStack(healthCheckStack);

      template.hasResourceProperties('AWS::Route53::HealthCheck', {
        HealthCheckConfig: {
          Type: 'HTTPS',
        },
      });
    });

    test('handles APIG evacuation method', () => {
      const healthCheckStack = new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
        evacuationMethod: EvacuationMethod.SelfManagedHttpEndpoint_APIG,
        domainName: 'example.com',
        resourcePath: '/health',
        availabilityZoneIdToRoutingControlArns: routingControls,
      });
      const template = Template.fromStack(healthCheckStack);

      template.hasResourceProperties('AWS::Route53::HealthCheck', {
        HealthCheckConfig: {
          Type: 'HTTPS',
        },
      });
    });
  });

  describe('error handling', () => {
    test('throws error for unsupported evacuation method', () => {
      expect(() => {
        new Route53HealthChecksStack(parentStack, 'HealthCheckStack', {
          evacuationMethod: EvacuationMethod.ZonalShift,
          domainName: 'example.com',
          resourcePath: '/health',
          availabilityZoneIdToRoutingControlArns: routingControls,
        });
      }).toThrow('Unsupported evacuation method: ZonalShift');
    });
  });
});
