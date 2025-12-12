import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { CodeDeployApplicationStack } from '../../../src/cdk/lib/nested-stacks/code-deploy-application-stack';
import { synthesizeStack, findResourcesByType, findResourceByType } from '../../helpers/stack-helpers';

describe('CodeDeployApplicationStack', () => {
  let app: cdk.App;
  let parentStack: cdk.Stack;
  let mockEc2Fleet: any;
  let alarm: cloudwatch.IAlarm;

  beforeEach(() => {
    app = new cdk.App();
    parentStack = new cdk.Stack(app, 'ParentStack', {
      env: { region: 'us-east-1', account: '123456789012' },
    });

    // Add required parameters that NestedStackWithSource expects
    new cdk.CfnParameter(parentStack, 'AssetsBucketName', {
      type: 'String',
      default: 'test-bucket',
    });

    new cdk.CfnParameter(parentStack, 'AssetsBucketPrefix', {
      type: 'String',
      default: 'test-prefix',
    });

    // Create mock EC2 fleet with minimal required properties
    // We use simple objects to avoid complex EC2FleetStack dependencies
    const mockAutoScalingGroup = {
      autoScalingGroupName: 'MockASG',
    };

    const mockTargetGroup = {
      targetGroupName: 'MockTargetGroup',
    };

    mockEc2Fleet = {
      autoScalingGroup: mockAutoScalingGroup,
      targetGroup: mockTargetGroup,
    };

    // Create test alarm
    alarm = new cloudwatch.Alarm(parentStack, 'TestAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'Test',
        metricName: 'TestMetric',
      }),
      threshold: 1,
      evaluationPeriods: 1,
    });
  });

  describe('stack creation', () => {
    test('synthesizes without errors', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      expect(() => synthesizeStack(codeDeployStack)).not.toThrow();
    });

    test('creates nested stack resource', () => {
      new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(parentStack);

      // Count nested stacks (EC2Fleet + CodeDeploy)
      const nestedStacks = findResourcesByType(template, 'AWS::CloudFormation::Stack');
      expect(nestedStacks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('CodeDeploy application creation', () => {
    test('creates CodeDeploy server application', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);
      template.resourceCountIs('AWS::CodeDeploy::Application', 1);
    });

    test('configures application with correct name', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'MyTestApplication',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);

      template.hasResourceProperties('AWS::CodeDeploy::Application', {
        ApplicationName: 'MyTestApplication',
      });
    });

    test('configures application for Server compute platform', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);

      template.hasResourceProperties('AWS::CodeDeploy::Application', {
        ComputePlatform: 'Server',
      });
    });
  });

  describe('deployment group configuration', () => {
    test('creates two deployment groups', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);

      // One zonal deployment group + one standard deployment group
      template.resourceCountIs('AWS::CodeDeploy::DeploymentGroup', 2);
    });

    test('configures zonal deployment group with correct name', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);

      template.hasResourceProperties('AWS::CodeDeploy::DeploymentGroup', {
        DeploymentGroupName: 'ZonalDeploymentGroup',
      });
    });

    test('associates deployment groups with application', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);

      const deploymentGroups = findResourcesByType(template, 'AWS::CodeDeploy::DeploymentGroup');
      deploymentGroups.forEach((group) => {
        expect(group.Properties.ApplicationName).toBeDefined();
      });
    });

    test('configures deployment style with traffic control', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);

      const deploymentGroups = findResourcesByType(template, 'AWS::CodeDeploy::DeploymentGroup');
      deploymentGroups.forEach((group) => {
        expect(group.Properties.DeploymentStyle).toEqual({
          DeploymentOption: 'WITH_TRAFFIC_CONTROL',
          DeploymentType: 'IN_PLACE',
        });
      });
    });

    test('configures EC2 tag filters for auto scaling group', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);

      template.hasResourceProperties('AWS::CodeDeploy::DeploymentGroup', {
        Ec2TagFilters: Match.arrayWith([
          Match.objectLike({
            Key: 'aws:autoscaling:groupName',
            Type: 'KEY_AND_VALUE',
          }),
        ]),
      });
    });

    test('standard deployment group includes initial deployment', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'test-app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);

      template.hasResourceProperties('AWS::CodeDeploy::DeploymentGroup', {
        Deployment: Match.objectLike({
          Revision: Match.objectLike({
            RevisionType: 'S3',
            S3Location: Match.objectLike({
              Key: 'test-app.zip',
              BundleType: 'zip',
            }),
          }),
        }),
      });
    });

    test('standard deployment group uses ALL_AT_ONCE config', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);

      template.hasResourceProperties('AWS::CodeDeploy::DeploymentGroup', {
        DeploymentConfigName: 'CodeDeployDefault.AllAtOnce',
      });
    });
  });

  describe('deployment configuration', () => {
    test('creates zonal deployment configuration', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);
      template.resourceCountIs('AWS::CodeDeploy::DeploymentConfig', 1);
    });

    test('configures deployment config for Server platform', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);

      template.hasResourceProperties('AWS::CodeDeploy::DeploymentConfig', {
        ComputePlatform: 'Server',
      });
    });

    test('configures zonal config with monitor durations', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);

      template.hasResourceProperties('AWS::CodeDeploy::DeploymentConfig', {
        ZonalConfig: Match.objectLike({
          FirstZoneMonitorDurationInSeconds: 180,
          MonitorDurationInSeconds: 60,
        }),
      });
    });

    test('configures minimum healthy hosts per zone', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 2,
      });
      const template = Template.fromStack(codeDeployStack);

      template.hasResourceProperties('AWS::CodeDeploy::DeploymentConfig', {
        ZonalConfig: Match.objectLike({
          MinimumHealthyHostsPerZone: {
            Type: 'HOST_COUNT',
            Value: 2,
          },
        }),
      });
    });

    test('calculates minimum healthy hosts based on fleet size', () => {
      const totalInstances = 9;
      const azCount = 3;
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: totalInstances,
        availabilityZoneCount: azCount,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);

      const expectedMinHealthy = Math.floor(totalInstances / azCount);
      template.hasResourceProperties('AWS::CodeDeploy::DeploymentConfig', {
        MinimumHealthyHosts: {
          Type: 'HOST_COUNT',
          Value: expectedMinHealthy,
        },
      });
    });
  });

  describe('IAM roles and policies', () => {
    test('creates IAM role for CodeDeploy', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);
      template.resourceCountIs('AWS::IAM::Role', 1);
    });

    test('configures role with CodeDeploy service principal', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);

      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: {
                Service: 'codedeploy.amazonaws.com',
              },
            }),
          ]),
        }),
      });
    });

    test('attaches AWS managed CodeDeploy policies', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);

      const role = findResourceByType(template, 'AWS::IAM::Role');
      expect(role.Properties.ManagedPolicyArns).toBeDefined();
      expect(role.Properties.ManagedPolicyArns.length).toBeGreaterThan(0);
    });

    test('creates custom managed policy for CodeDeploy', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);
      template.resourceCountIs('AWS::IAM::ManagedPolicy', 1);
    });

    test('custom policy includes EC2 and CloudWatch permissions', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);

      template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                'ec2:RunInstances',
                'ec2:CreateTags',
                'iam:PassRole',
                'cloudwatch:DescribeAlarms',
              ]),
            }),
          ]),
        }),
      });
    });

    test('uses custom IAM resource path when provided', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
        iamResourcePath: '/custom/path/',
      });
      const template = Template.fromStack(codeDeployStack);

      template.hasResourceProperties('AWS::IAM::Role', {
        Path: '/custom/path/',
      });
    });

    test('uses default IAM resource path when not provided', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);

      template.hasResourceProperties('AWS::IAM::Role', {
        Path: '/codedeploy/',
      });
    });
  });

  describe('load balancer integration', () => {
    test('configures deployment groups with target group', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);

      const deploymentGroups = findResourcesByType(template, 'AWS::CodeDeploy::DeploymentGroup');
      deploymentGroups.forEach((group) => {
        expect(group.Properties.LoadBalancerInfo).toBeDefined();
        expect(group.Properties.LoadBalancerInfo.TargetGroupInfoList).toBeDefined();
        expect(Array.isArray(group.Properties.LoadBalancerInfo.TargetGroupInfoList)).toBe(true);
      });
    });

    test('references EC2 fleet target group', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);

      template.hasResourceProperties('AWS::CodeDeploy::DeploymentGroup', {
        LoadBalancerInfo: Match.objectLike({
          TargetGroupInfoList: Match.arrayWith([
            Match.objectLike({
              Name: Match.anyValue(),
            }),
          ]),
        }),
      });
    });
  });

  describe('alarm configuration', () => {
    test('configures alarms when provided', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
        alarms: [alarm],
      });
      const template = Template.fromStack(codeDeployStack);

      template.hasResourceProperties('AWS::CodeDeploy::DeploymentGroup', {
        AlarmConfiguration: Match.objectLike({
          Enabled: true,
          Alarms: Match.arrayWith([
            Match.objectLike({
              Name: Match.anyValue(),
            }),
          ]),
        }),
      });
    });

    test('omits alarm configuration when no alarms provided', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);

      const zonalGroup = findResourcesByType(template, 'AWS::CodeDeploy::DeploymentGroup')
        .find((group) => group.Properties.DeploymentGroupName === 'ZonalDeploymentGroup');

      expect(zonalGroup?.Properties.AlarmConfiguration).toBeUndefined();
    });

    test('handles multiple alarms', () => {
      const alarm2 = new cloudwatch.Alarm(parentStack, 'TestAlarm2', {
        metric: new cloudwatch.Metric({
          namespace: 'Test',
          metricName: 'TestMetric2',
        }),
        threshold: 2,
        evaluationPeriods: 1,
      });

      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
        alarms: [alarm, alarm2],
      });
      const template = Template.fromStack(codeDeployStack);

      const zonalGroup = findResourcesByType(template, 'AWS::CodeDeploy::DeploymentGroup')
        .find((group) => group.Properties.DeploymentGroupName === 'ZonalDeploymentGroup');

      expect(zonalGroup?.Properties.AlarmConfiguration.Alarms.length).toBe(2);
    });
  });

  describe('stack parameters', () => {
    test('uses AssetsBucketName parameter for S3 location', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);

      template.hasResourceProperties('AWS::CodeDeploy::DeploymentGroup', {
        Deployment: Match.objectLike({
          Revision: Match.objectLike({
            S3Location: Match.objectLike({
              Bucket: Match.objectLike({
                Ref: 'AssetsBucketName',
              }),
            }),
          }),
        }),
      });
    });

    test('accepts different application keys', () => {
      const customKey = 'custom-deployment.zip';
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: customKey,
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);

      template.hasResourceProperties('AWS::CodeDeploy::DeploymentGroup', {
        Deployment: Match.objectLike({
          Revision: Match.objectLike({
            S3Location: Match.objectLike({
              Key: customKey,
            }),
          }),
        }),
      });
    });
  });

  describe('public interface', () => {
    test('exposes CodeDeploy application', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });

      expect(codeDeployStack.application).toBeDefined();
      expect(codeDeployStack.application.applicationName).toBeDefined();
    });

    test('exposes front end deployment group', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });

      expect(codeDeployStack.frontEndDeploymentGroup).toBeDefined();
      expect(codeDeployStack.frontEndDeploymentGroup.ref).toBeDefined();
    });
  });

  describe('CloudFormation resources', () => {
    test('creates all required resource types', () => {
      const codeDeployStack = new CodeDeployApplicationStack(parentStack, 'CodeDeployStack', {
        ec2Fleet: mockEc2Fleet,
        applicationKey: 'app.zip',
        totalEC2InstancesInFleet: 6,
        availabilityZoneCount: 3,
        applicationName: 'TestApp',
        minimumHealthyHostsPerZone: 1,
      });
      const template = Template.fromStack(codeDeployStack);

      template.resourceCountIs('AWS::CodeDeploy::Application', 1);
      template.resourceCountIs('AWS::CodeDeploy::DeploymentConfig', 1);
      template.resourceCountIs('AWS::CodeDeploy::DeploymentGroup', 2);
      template.resourceCountIs('AWS::IAM::Role', 1);
      template.resourceCountIs('AWS::IAM::ManagedPolicy', 1);
    });
  });
});
