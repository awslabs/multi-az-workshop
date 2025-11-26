import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ApplicationRecoveryControllerStack } from '../../../src/cdk/lib/nested-stacks/application-recovery-controller-stack';
import { synthesizeStack, findResourcesByType, findResourceByType } from '../../helpers/stack-helpers';

describe('ApplicationRecoveryControllerStack', () => {
  let app: App;
  let parentStack: Stack;
  const testAvailabilityZoneIds = ['use1-az1', 'use1-az2', 'use1-az3'];

  beforeEach(() => {
    app = new App();
    parentStack = new Stack(app, 'ParentStack', {
      env: { region: 'us-east-1', account: '123456789012' },
    });
  });

  describe('stack creation', () => {
    test('synthesizes without errors', () => {
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });
      expect(() => synthesizeStack(arcStack)).not.toThrow();
    });

    test('creates nested stack resource', () => {
      new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });
      const template = Template.fromStack(parentStack);
      template.resourceCountIs('AWS::CloudFormation::Stack', 1);
    });
  });

  describe('ARC cluster creation', () => {
    test('creates Route53 Recovery Control cluster', () => {
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });
      const template = Template.fromStack(arcStack);
      template.resourceCountIs('AWS::Route53RecoveryControl::Cluster', 1);
    });

    test('configures cluster with correct name', () => {
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });
      const template = Template.fromStack(arcStack);

      template.hasResourceProperties('AWS::Route53RecoveryControl::Cluster', {
        Name: 'AZEvacuationCluster',
      });
    });

    test('cluster has ARN attribute', () => {
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });
      const template = Template.fromStack(arcStack);

      const cluster = findResourceByType(template, 'AWS::Route53RecoveryControl::Cluster');
      expect(cluster).toBeDefined();
      expect(cluster.logicalId).toMatch(/Cluster/);
    });
  });

  describe('control panel configuration', () => {
    test('creates control panel', () => {
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });
      const template = Template.fromStack(arcStack);
      template.resourceCountIs('AWS::Route53RecoveryControl::ControlPanel', 1);
    });

    test('configures control panel with correct name', () => {
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });
      const template = Template.fromStack(arcStack);

      template.hasResourceProperties('AWS::Route53RecoveryControl::ControlPanel', {
        Name: 'AZEvacuationControlPanel',
      });
    });

    test('associates control panel with cluster', () => {
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });
      const template = Template.fromStack(arcStack);

      template.hasResourceProperties('AWS::Route53RecoveryControl::ControlPanel', {
        ClusterArn: Match.objectLike({
          'Fn::GetAtt': Match.arrayWith([
            Match.stringLikeRegexp('Cluster'),
            'ClusterArn',
          ]),
        }),
      });
    });
  });

  describe('routing control creation', () => {
    test('creates routing control for each availability zone', () => {
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });
      const template = Template.fromStack(arcStack);
      template.resourceCountIs('AWS::Route53RecoveryControl::RoutingControl', testAvailabilityZoneIds.length);
    });

    test('configures routing controls with AZ IDs as names', () => {
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });
      const template = Template.fromStack(arcStack);

      testAvailabilityZoneIds.forEach((azId) => {
        template.hasResourceProperties('AWS::Route53RecoveryControl::RoutingControl', {
          Name: azId,
        });
      });
    });

    test('associates routing controls with cluster', () => {
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });
      const template = Template.fromStack(arcStack);

      const routingControls = findResourcesByType(template, 'AWS::Route53RecoveryControl::RoutingControl');
      routingControls.forEach((control) => {
        expect(control.Properties.ClusterArn).toBeDefined();
        expect(control.Properties.ClusterArn['Fn::GetAtt']).toEqual(
          expect.arrayContaining([expect.stringMatching(/Cluster/), 'ClusterArn']),
        );
      });
    });

    test('associates routing controls with control panel', () => {
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });
      const template = Template.fromStack(arcStack);

      const routingControls = findResourcesByType(template, 'AWS::Route53RecoveryControl::RoutingControl');
      routingControls.forEach((control) => {
        expect(control.Properties.ControlPanelArn).toBeDefined();
        expect(control.Properties.ControlPanelArn['Fn::GetAtt']).toEqual(
          expect.arrayContaining([expect.stringMatching(/ControlPlane/), 'ControlPanelArn']),
        );
      });
    });

    test('creates routing controls with sequential logical IDs', () => {
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });
      const template = Template.fromStack(arcStack);

      const routingControls = findResourcesByType(template, 'AWS::Route53RecoveryControl::RoutingControl');
      const logicalIds = routingControls.map((control) => control.logicalId);

      expect(logicalIds.some((id) => /AZ1/.test(id))).toBe(true);
      expect(logicalIds.some((id) => /AZ2/.test(id))).toBe(true);
      expect(logicalIds.some((id) => /AZ3/.test(id))).toBe(true);
    });
  });

  describe('safety rule configuration', () => {
    test('creates assertion safety rule', () => {
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });
      const template = Template.fromStack(arcStack);
      template.resourceCountIs('AWS::Route53RecoveryControl::SafetyRule', 1);
    });

    test('configures safety rule with correct name', () => {
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });
      const template = Template.fromStack(arcStack);

      template.hasResourceProperties('AWS::Route53RecoveryControl::SafetyRule', {
        Name: 'AtMost1AZOff',
      });
    });

    test('associates safety rule with control panel', () => {
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });
      const template = Template.fromStack(arcStack);

      template.hasResourceProperties('AWS::Route53RecoveryControl::SafetyRule', {
        ControlPanelArn: Match.objectLike({
          'Fn::GetAtt': Match.arrayWith([
            Match.stringLikeRegexp('ControlPlane'),
            'ControlPanelArn',
          ]),
        }),
      });
    });

    test('configures assertion rule with all routing controls', () => {
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });
      const template = Template.fromStack(arcStack);

      const safetyRule = findResourceByType(template, 'AWS::Route53RecoveryControl::SafetyRule');
      expect(safetyRule.Properties.AssertionRule).toBeDefined();
      expect(safetyRule.Properties.AssertionRule.AssertedControls).toBeDefined();
      expect(safetyRule.Properties.AssertionRule.AssertedControls.length).toBe(testAvailabilityZoneIds.length);
    });

    test('configures assertion rule with wait period', () => {
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });
      const template = Template.fromStack(arcStack);

      template.hasResourceProperties('AWS::Route53RecoveryControl::SafetyRule', {
        AssertionRule: Match.objectLike({
          WaitPeriodMs: 5000,
        }),
      });
    });

    test('configures rule with ATLEAST threshold of 2', () => {
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });
      const template = Template.fromStack(arcStack);

      template.hasResourceProperties('AWS::Route53RecoveryControl::SafetyRule', {
        RuleConfig: {
          Inverted: false,
          Threshold: 2,
          Type: 'ATLEAST',
        },
      });
    });
  });

  describe('public interface', () => {
    test('exposes routing controls per availability zone ID', () => {
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });

      expect(arcStack.routingControlsPerAvailabilityZoneId).toBeDefined();
      expect(Object.keys(arcStack.routingControlsPerAvailabilityZoneId)).toHaveLength(testAvailabilityZoneIds.length);
    });

    test('routing controls map contains all AZ IDs', () => {
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });

      testAvailabilityZoneIds.forEach((azId) => {
        expect(arcStack.routingControlsPerAvailabilityZoneId[azId]).toBeDefined();
      });
    });

    test('routing controls are CfnRoutingControl instances', () => {
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });

      testAvailabilityZoneIds.forEach((azId) => {
        const control = arcStack.routingControlsPerAvailabilityZoneId[azId];
        expect(control).toBeDefined();
        expect(control.ref).toBeDefined();
      });
    });
  });

  describe('stack parameters', () => {
    test('accepts availability zone IDs parameter', () => {
      const customAzIds = ['use1-az4', 'use1-az5'];
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: customAzIds,
      });
      const template = Template.fromStack(arcStack);

      template.resourceCountIs('AWS::Route53RecoveryControl::RoutingControl', customAzIds.length);
    });

    test('handles single availability zone', () => {
      const singleAz = ['use1-az1'];
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: singleAz,
      });
      const template = Template.fromStack(arcStack);

      template.resourceCountIs('AWS::Route53RecoveryControl::RoutingControl', 1);
    });

    test('handles multiple availability zones', () => {
      const multipleAzs = ['use1-az1', 'use1-az2', 'use1-az3', 'use1-az4'];
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: multipleAzs,
      });
      const template = Template.fromStack(arcStack);

      template.resourceCountIs('AWS::Route53RecoveryControl::RoutingControl', multipleAzs.length);
    });
  });

  describe('CloudFormation resources', () => {
    test('creates all required resource types', () => {
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });
      const template = Template.fromStack(arcStack);

      template.resourceCountIs('AWS::Route53RecoveryControl::Cluster', 1);
      template.resourceCountIs('AWS::Route53RecoveryControl::ControlPanel', 1);
      template.resourceCountIs('AWS::Route53RecoveryControl::RoutingControl', testAvailabilityZoneIds.length);
      template.resourceCountIs('AWS::Route53RecoveryControl::SafetyRule', 1);
    });

    test('total resource count matches expected', () => {
      const arcStack = new ApplicationRecoveryControllerStack(parentStack, 'ARCStack', {
        availabilityZoneIds: testAvailabilityZoneIds,
      });
      const template = Template.fromStack(arcStack);

      const templateJson = template.toJSON();
      const resourceCount = Object.keys(templateJson.Resources || {}).length;

      // 1 cluster + 1 control panel + N routing controls + 1 safety rule
      const expectedCount = 1 + 1 + testAvailabilityZoneIds.length + 1;
      expect(resourceCount).toBe(expectedCount);
    });
  });
});
