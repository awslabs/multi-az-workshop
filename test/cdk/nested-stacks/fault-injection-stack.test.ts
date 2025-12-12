import { App, Stack, Duration } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import { IPAddressType } from '../../../src/cdk/lib/constructs/ip-address-type';
import { VpcIpV6, IVpcIpV6 } from '../../../src/cdk/lib/constructs/vpc-ipv6-construct';
import { FaultInjectionStack } from '../../../src/cdk/lib/nested-stacks/fault-injection-stack';
import { synthesizeStack, findResourcesByType } from '../../helpers/stack-helpers';

describe('FaultInjectionStack', () => {
  let app: App;
  let parentStack: Stack;
  let vpc: IVpcIpV6;
  let database: rds.DatabaseCluster;
  let autoScalingGroup: autoscaling.AutoScalingGroup;
  let sharedFisStack: FaultInjectionStack;
  let sharedTemplate: Template;
  let sharedParentTemplate: Template;
  const azNames = ['us-east-1a', 'us-east-1b', 'us-east-1c'];

  beforeAll(() => {
    app = new App();
    parentStack = new Stack(app, 'ParentStack', {
      env: { region: 'us-east-1', account: '123456789012' },
    });

    // Create VPC
    vpc = new VpcIpV6(parentStack, 'VPC', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      availabilityZones: azNames,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          subnetIpConfiguration: IPAddressType.IPv4,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          subnetIpConfiguration: IPAddressType.IPv4,
        },
        {
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          subnetIpConfiguration: IPAddressType.IPv4,
        },
      ],
    });

    // Create database cluster
    database = new rds.DatabaseCluster(parentStack, 'Database', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_1,
      }),
      writer: rds.ClusterInstance.provisioned('writer', {
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    // Create auto scaling group
    autoScalingGroup = new autoscaling.AutoScalingGroup(parentStack, 'ASG', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3A, ec2.InstanceSize.MEDIUM),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      minCapacity: 3,
      maxCapacity: 3,
    });

    // Create shared FIS stack
    sharedFisStack = new FaultInjectionStack(parentStack, 'FISStack', {
      azNames,
      azCount: 3,
      database,
      logGroupName: '/aws/fis/experiments',
      logGroupRetention: logs.RetentionDays.ONE_WEEK,
      autoScalingGroup,
    });

    sharedTemplate = Template.fromStack(sharedFisStack);
    sharedParentTemplate = Template.fromStack(parentStack);
  });

  describe('stack creation', () => {
    test('synthesizes without errors', () => {
      expect(() => synthesizeStack(sharedFisStack)).not.toThrow();
    });

    test('creates nested stack resource', () => {
      sharedParentTemplate.resourceCountIs('AWS::CloudFormation::Stack', 1);
    });
  });

  describe('FIS experiment template creation', () => {
    test('creates latency experiment templates for each AZ', () => {
      const experiments = findResourcesByType(sharedTemplate, 'AWS::FIS::ExperimentTemplate');
      const latencyExperiments = experiments.filter((exp) =>
        exp.Properties.Description?.includes('latency'),
      );
      expect(latencyExperiments.length).toBe(3);
    });

    test('creates packet loss experiment templates for each AZ', () => {
      const experiments = findResourcesByType(sharedTemplate, 'AWS::FIS::ExperimentTemplate');
      const packetLossExperiments = experiments.filter((exp) =>
        exp.Properties.Description?.includes('packets'),
      );
      expect(packetLossExperiments.length).toBe(3);
    });

    test('creates CPU stress test experiment templates for each AZ', () => {
      const experiments = findResourcesByType(sharedTemplate, 'AWS::FIS::ExperimentTemplate');
      const cpuStressExperiments = experiments.filter((exp) =>
        exp.Properties.Description?.includes('CPU stress'),
      );
      expect(cpuStressExperiments.length).toBe(3);
    });

    test('exposes latency experiments as public property', () => {
      expect(sharedFisStack.latencyExperiments).toBeDefined();
      expect(sharedFisStack.latencyExperiments.length).toBe(3);
    });

    test('exposes packet loss experiments as public property', () => {
      expect(sharedFisStack.packetLossExperiments).toBeDefined();
      expect(sharedFisStack.packetLossExperiments.length).toBe(3);
    });

    test('exposes CPU stress test experiments as public property', () => {
      expect(sharedFisStack.cpuStressTestExperiments).toBeDefined();
      expect(sharedFisStack.cpuStressTestExperiments.length).toBe(3);
    });
  });

  describe('experiment actions configuration', () => {
    test('configures latency action with SSM document', () => {
      sharedTemplate.hasResourceProperties('AWS::FIS::ExperimentTemplate', {
        Actions: Match.objectLike({
          addLatency: Match.objectLike({
            ActionId: 'aws:ssm:send-command',
            Parameters: Match.objectLike({
              documentArn: Match.objectLike({
                'Fn::Sub': Match.stringLikeRegexp('AWSFIS-Run-Network-Latency-Sources'),
              }),
            }),
          }),
        }),
      });
    });

    test('configures packet loss action with SSM document', () => {
      sharedTemplate.hasResourceProperties('AWS::FIS::ExperimentTemplate', {
        Actions: Match.objectLike({
          packetLoss: Match.objectLike({
            ActionId: 'aws:ssm:send-command',
            Parameters: Match.objectLike({
              documentArn: Match.objectLike({
                'Fn::Sub': Match.stringLikeRegexp('AWSFIS-Run-Network-Packet-Loss-Sources'),
              }),
            }),
          }),
        }),
      });
    });

    test('configures CPU stress action with SSM document', () => {
      sharedTemplate.hasResourceProperties('AWS::FIS::ExperimentTemplate', {
        Actions: Match.objectLike({
          cpuStress: Match.objectLike({
            ActionId: 'aws:ssm:send-command',
            Parameters: Match.objectLike({
              documentArn: Match.objectLike({
                'Fn::Sub': Match.stringLikeRegexp('AWSFIS-Run-CPU-Stress'),
              }),
            }),
          }),
        }),
      });
    });

    describe('custom configurations', () => {
      test('uses custom delay milliseconds when provided', () => {
        const customApp = new App();
        const customParentStack = new Stack(customApp, 'CustomParentStack', {
          env: { region: 'us-east-1', account: '123456789012' },
        });
        const customVpc = new VpcIpV6(customParentStack, 'CustomVPC', {
          ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
          availabilityZones: azNames,
          subnetConfiguration: [
            {
              name: 'Public',
              subnetType: ec2.SubnetType.PUBLIC,
              subnetIpConfiguration: IPAddressType.IPv4,
            },
            {
              name: 'Private',
              subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
              subnetIpConfiguration: IPAddressType.IPv4,
            },
            {
              name: 'Isolated',
              subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
              subnetIpConfiguration: IPAddressType.IPv4,
            },
          ],
        });
        const customDatabase = new rds.DatabaseCluster(customParentStack, 'CustomDatabase', {
          engine: rds.DatabaseClusterEngine.auroraPostgres({
            version: rds.AuroraPostgresEngineVersion.VER_16_1,
          }),
          writer: rds.ClusterInstance.provisioned('writer', {
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
          }),
          vpc: customVpc,
          vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        });
        const customAsg = new autoscaling.AutoScalingGroup(customParentStack, 'CustomASG', {
          vpc: customVpc,
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3A, ec2.InstanceSize.MEDIUM),
          machineImage: ec2.MachineImage.latestAmazonLinux2023(),
          minCapacity: 3,
          maxCapacity: 3,
        });

        const fisStack = new FaultInjectionStack(customParentStack, 'FISStack', {
          azNames,
          azCount: 3,
          database: customDatabase,
          logGroupName: '/aws/fis/experiments',
          logGroupRetention: logs.RetentionDays.ONE_WEEK,
          autoScalingGroup: customAsg,
          delayMilliseconds: Duration.millis(200),
        });

        expect(() => synthesizeStack(fisStack)).not.toThrow();
        expect(fisStack.latencyExperiments.length).toBe(3);
      });

      test('uses custom packet loss percentage when provided', () => {
        const customApp = new App();
        const customParentStack = new Stack(customApp, 'CustomParentStack', {
          env: { region: 'us-east-1', account: '123456789012' },
        });
        const customVpc = new VpcIpV6(customParentStack, 'CustomVPC', {
          ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
          availabilityZones: azNames,
          subnetConfiguration: [
            {
              name: 'Public',
              subnetType: ec2.SubnetType.PUBLIC,
              subnetIpConfiguration: IPAddressType.IPv4,
            },
            {
              name: 'Private',
              subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
              subnetIpConfiguration: IPAddressType.IPv4,
            },
            {
              name: 'Isolated',
              subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
              subnetIpConfiguration: IPAddressType.IPv4,
            },
          ],
        });
        const customDatabase = new rds.DatabaseCluster(customParentStack, 'CustomDatabase', {
          engine: rds.DatabaseClusterEngine.auroraPostgres({
            version: rds.AuroraPostgresEngineVersion.VER_16_1,
          }),
          writer: rds.ClusterInstance.provisioned('writer', {
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
          }),
          vpc: customVpc,
          vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        });
        const customAsg = new autoscaling.AutoScalingGroup(customParentStack, 'CustomASG', {
          vpc: customVpc,
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3A, ec2.InstanceSize.MEDIUM),
          machineImage: ec2.MachineImage.latestAmazonLinux2023(),
          minCapacity: 3,
          maxCapacity: 3,
        });

        const fisStack = new FaultInjectionStack(customParentStack, 'FISStack', {
          azNames,
          azCount: 3,
          database: customDatabase,
          logGroupName: '/aws/fis/experiments',
          logGroupRetention: logs.RetentionDays.ONE_WEEK,
          autoScalingGroup: customAsg,
          packetLossPercent: 25,
        });

        expect(() => synthesizeStack(fisStack)).not.toThrow();
        expect(fisStack.packetLossExperiments.length).toBe(3);
      });

      test('uses custom network interface when provided', () => {
        const customApp = new App();
        const customParentStack = new Stack(customApp, 'CustomParentStack', {
          env: { region: 'us-east-1', account: '123456789012' },
        });
        const customVpc = new VpcIpV6(customParentStack, 'CustomVPC', {
          ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
          availabilityZones: azNames,
          subnetConfiguration: [
            {
              name: 'Public',
              subnetType: ec2.SubnetType.PUBLIC,
              subnetIpConfiguration: IPAddressType.IPv4,
            },
            {
              name: 'Private',
              subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
              subnetIpConfiguration: IPAddressType.IPv4,
            },
            {
              name: 'Isolated',
              subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
              subnetIpConfiguration: IPAddressType.IPv4,
            },
          ],
        });
        const customDatabase = new rds.DatabaseCluster(customParentStack, 'CustomDatabase', {
          engine: rds.DatabaseClusterEngine.auroraPostgres({
            version: rds.AuroraPostgresEngineVersion.VER_16_1,
          }),
          writer: rds.ClusterInstance.provisioned('writer', {
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
          }),
          vpc: customVpc,
          vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        });
        const customAsg = new autoscaling.AutoScalingGroup(customParentStack, 'CustomASG', {
          vpc: customVpc,
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3A, ec2.InstanceSize.MEDIUM),
          machineImage: ec2.MachineImage.latestAmazonLinux2023(),
          minCapacity: 3,
          maxCapacity: 3,
        });

        const fisStack = new FaultInjectionStack(customParentStack, 'FISStack', {
          azNames,
          azCount: 3,
          database: customDatabase,
          logGroupName: '/aws/fis/experiments',
          logGroupRetention: logs.RetentionDays.ONE_WEEK,
          autoScalingGroup: customAsg,
          interface: 'eth0',
        });

        expect(() => synthesizeStack(fisStack)).not.toThrow();
        expect(fisStack.latencyExperiments.length).toBe(3);
      });
    });
  });

  describe('target configuration', () => {
    test('targets EC2 instances in specific AZ', () => {
      sharedTemplate.hasResourceProperties('AWS::FIS::ExperimentTemplate', {
        Targets: Match.objectLike({
          oneAZ: Match.objectLike({
            ResourceType: 'aws:ec2:instance',
            SelectionMode: 'ALL',
          }),
        }),
      });
    });

    test('filters targets by availability zone', () => {
      const experiments = findResourcesByType(sharedTemplate, 'AWS::FIS::ExperimentTemplate');
      expect(experiments.length).toBeGreaterThan(0);
      const firstExperiment = experiments[0];
      expect(firstExperiment.Properties.Targets.oneAZ.Filters).toBeDefined();
      const azFilter = firstExperiment.Properties.Targets.oneAZ.Filters.find((f: any) =>
        f.Path === 'Placement.AvailabilityZone',
      );
      expect(azFilter).toBeDefined();
      expect(azFilter.Values).toBeDefined();
      expect(azFilter.Values.length).toBe(1);
    });

    test('filters targets by auto scaling group', () => {
      sharedTemplate.hasResourceProperties('AWS::FIS::ExperimentTemplate', {
        Targets: Match.objectLike({
          oneAZ: Match.objectLike({
            ResourceTags: Match.objectLike({
              'aws:autoscaling:groupName': Match.anyValue(),
            }),
          }),
        }),
      });
    });
  });

  describe('stop conditions', () => {
    test('configures stop condition', () => {
      sharedTemplate.hasResourceProperties('AWS::FIS::ExperimentTemplate', {
        StopConditions: Match.arrayWith([
          Match.objectLike({
            Source: 'none',
          }),
        ]),
      });
    });
  });

  describe('IAM role and policies', () => {
    test('creates IAM role for FIS', () => {
      sharedTemplate.resourceCountIs('AWS::IAM::Role', 1);
      sharedTemplate.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: Match.objectLike({
                Service: Match.arrayWith(['fis.amazonaws.com']),
              }),
              Condition: Match.objectLike({
                StringEquals: Match.objectLike({
                  'aws:SourceAccount': Match.anyValue(),
                }),
                ArnLike: Match.objectLike({
                  'aws:SourceArn': Match.anyValue(),
                }),
              }),
            }),
          ]),
        }),
      });
    });

    test('attaches AWS managed policies for FIS', () => {
      const roles = findResourcesByType(sharedTemplate, 'AWS::IAM::Role');
      expect(roles.length).toBe(1);
      const managedPolicies = roles[0].Properties.ManagedPolicyArns;
      expect(managedPolicies).toBeDefined();
      expect(Array.isArray(managedPolicies)).toBe(true);
      expect(managedPolicies.length).toBeGreaterThan(0);
    });

    test('creates managed policy for CloudWatch Logs', () => {
      sharedTemplate.resourceCountIs('AWS::IAM::ManagedPolicy', 1);
      sharedTemplate.hasResourceProperties('AWS::IAM::ManagedPolicy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                'logs:CreateLogStream',
                'logs:PutLogEvents',
              ]),
              Effect: 'Allow',
            }),
          ]),
        }),
      });
    });

    test('experiment templates reference IAM role', () => {
      sharedTemplate.hasResourceProperties('AWS::FIS::ExperimentTemplate', {
        RoleArn: Match.objectLike({
          'Fn::GetAtt': Match.arrayWith([
            Match.stringLikeRegexp('FISRole'),
            'Arn',
          ]),
        }),
      });
    });
  });

  describe('CloudWatch log group', () => {
    test('creates log group', () => {
      sharedTemplate.resourceCountIs('AWS::Logs::LogGroup', 1);
    });

    test('configures log group with correct name', () => {
      sharedTemplate.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/aws/fis/experiments',
      });
    });

    test('sets removal policy to DESTROY', () => {
      const logGroups = findResourcesByType(sharedTemplate, 'AWS::Logs::LogGroup');
      expect(logGroups.length).toBe(1);
      expect(logGroups[0].DeletionPolicy).toBe('Delete');
    });

    test('exposes log group as public property', () => {
      expect(sharedFisStack.logGroup).toBeDefined();
    });

    describe('alternative configurations', () => {
      test('configures log group with custom name', () => {
        const customApp = new App();
        const customParentStack = new Stack(customApp, 'CustomParentStack', {
          env: { region: 'us-east-1', account: '123456789012' },
        });
        const customVpc = new VpcIpV6(customParentStack, 'CustomVPC', {
          ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
          availabilityZones: azNames,
          subnetConfiguration: [
            {
              name: 'Public',
              subnetType: ec2.SubnetType.PUBLIC,
              subnetIpConfiguration: IPAddressType.IPv4,
            },
            {
              name: 'Private',
              subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
              subnetIpConfiguration: IPAddressType.IPv4,
            },
            {
              name: 'Isolated',
              subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
              subnetIpConfiguration: IPAddressType.IPv4,
            },
          ],
        });
        const customDatabase = new rds.DatabaseCluster(customParentStack, 'CustomDatabase', {
          engine: rds.DatabaseClusterEngine.auroraPostgres({
            version: rds.AuroraPostgresEngineVersion.VER_16_1,
          }),
          writer: rds.ClusterInstance.provisioned('writer', {
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
          }),
          vpc: customVpc,
          vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        });
        const customAsg = new autoscaling.AutoScalingGroup(customParentStack, 'CustomASG', {
          vpc: customVpc,
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3A, ec2.InstanceSize.MEDIUM),
          machineImage: ec2.MachineImage.latestAmazonLinux2023(),
          minCapacity: 3,
          maxCapacity: 3,
        });

        const fisStack = new FaultInjectionStack(customParentStack, 'FISStack', {
          azNames,
          azCount: 3,
          database: customDatabase,
          logGroupName: '/aws/fis/test-experiments',
          logGroupRetention: logs.RetentionDays.ONE_WEEK,
          autoScalingGroup: customAsg,
        });

        const template = Template.fromStack(fisStack);
        template.hasResourceProperties('AWS::Logs::LogGroup', {
          LogGroupName: '/aws/fis/test-experiments',
        });
      });

      test('configures log group with custom retention', () => {
        const customApp = new App();
        const customParentStack = new Stack(customApp, 'CustomParentStack', {
          env: { region: 'us-east-1', account: '123456789012' },
        });
        const customVpc = new VpcIpV6(customParentStack, 'CustomVPC', {
          ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
          availabilityZones: azNames,
          subnetConfiguration: [
            {
              name: 'Public',
              subnetType: ec2.SubnetType.PUBLIC,
              subnetIpConfiguration: IPAddressType.IPv4,
            },
            {
              name: 'Private',
              subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
              subnetIpConfiguration: IPAddressType.IPv4,
            },
            {
              name: 'Isolated',
              subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
              subnetIpConfiguration: IPAddressType.IPv4,
            },
          ],
        });
        const customDatabase = new rds.DatabaseCluster(customParentStack, 'CustomDatabase', {
          engine: rds.DatabaseClusterEngine.auroraPostgres({
            version: rds.AuroraPostgresEngineVersion.VER_16_1,
          }),
          writer: rds.ClusterInstance.provisioned('writer', {
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
          }),
          vpc: customVpc,
          vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        });
        const customAsg = new autoscaling.AutoScalingGroup(customParentStack, 'CustomASG', {
          vpc: customVpc,
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3A, ec2.InstanceSize.MEDIUM),
          machineImage: ec2.MachineImage.latestAmazonLinux2023(),
          minCapacity: 3,
          maxCapacity: 3,
        });

        const fisStack = new FaultInjectionStack(customParentStack, 'FISStack', {
          azNames,
          azCount: 3,
          database: customDatabase,
          logGroupName: '/aws/fis/experiments',
          logGroupRetention: logs.RetentionDays.TWO_WEEKS,
          autoScalingGroup: customAsg,
        });

        const template = Template.fromStack(fisStack);
        template.hasResourceProperties('AWS::Logs::LogGroup', {
          RetentionInDays: 14,
        });
      });
    });
  });

  describe('log configuration', () => {
    test('configures CloudWatch Logs for experiments', () => {
      sharedTemplate.hasResourceProperties('AWS::FIS::ExperimentTemplate', {
        LogConfiguration: Match.objectLike({
          CloudWatchLogsConfiguration: Match.objectLike({
            LogGroupArn: Match.anyValue(),
          }),
        }),
      });
    });

    test('uses default log schema version when not provided', () => {
      sharedTemplate.hasResourceProperties('AWS::FIS::ExperimentTemplate', {
        LogConfiguration: Match.objectLike({
          LogSchemaVersion: 2,
        }),
      });
    });

    describe('custom log schema version', () => {
      test('uses custom log schema version when provided', () => {
        const customApp = new App();
        const customParentStack = new Stack(customApp, 'CustomParentStack', {
          env: { region: 'us-east-1', account: '123456789012' },
        });
        const customVpc = new VpcIpV6(customParentStack, 'CustomVPC', {
          ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
          availabilityZones: azNames,
          subnetConfiguration: [
            {
              name: 'Public',
              subnetType: ec2.SubnetType.PUBLIC,
              subnetIpConfiguration: IPAddressType.IPv4,
            },
            {
              name: 'Private',
              subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
              subnetIpConfiguration: IPAddressType.IPv4,
            },
            {
              name: 'Isolated',
              subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
              subnetIpConfiguration: IPAddressType.IPv4,
            },
          ],
        });
        const customDatabase = new rds.DatabaseCluster(customParentStack, 'CustomDatabase', {
          engine: rds.DatabaseClusterEngine.auroraPostgres({
            version: rds.AuroraPostgresEngineVersion.VER_16_1,
          }),
          writer: rds.ClusterInstance.provisioned('writer', {
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
          }),
          vpc: customVpc,
          vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        });
        const customAsg = new autoscaling.AutoScalingGroup(customParentStack, 'CustomASG', {
          vpc: customVpc,
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3A, ec2.InstanceSize.MEDIUM),
          machineImage: ec2.MachineImage.latestAmazonLinux2023(),
          minCapacity: 3,
          maxCapacity: 3,
        });

        const fisStack = new FaultInjectionStack(customParentStack, 'FISStack', {
          azNames,
          azCount: 3,
          database: customDatabase,
          logGroupName: '/aws/fis/experiments',
          logGroupRetention: logs.RetentionDays.ONE_WEEK,
          autoScalingGroup: customAsg,
          logSchemaVersion: 1,
        });

        const template = Template.fromStack(fisStack);
        template.hasResourceProperties('AWS::FIS::ExperimentTemplate', {
          LogConfiguration: Match.objectLike({
            LogSchemaVersion: 1,
          }),
        });
      });
    });
  });

  describe('stack parameters', () => {
    test('creates experiments for different AZ counts', () => {
      const customApp = new App();
      const customParentStack = new Stack(customApp, 'CustomParentStack', {
        env: { region: 'us-east-1', account: '123456789012' },
      });
      const customAzNames = ['us-east-1a', 'us-east-1b'];
      const customVpc = new VpcIpV6(customParentStack, 'CustomVPC', {
        ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
        availabilityZones: customAzNames,
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            subnetIpConfiguration: IPAddressType.IPv4,
          },
          {
            name: 'Private',
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            subnetIpConfiguration: IPAddressType.IPv4,
          },
          {
            name: 'Isolated',
            subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            subnetIpConfiguration: IPAddressType.IPv4,
          },
        ],
      });
      const customDatabase = new rds.DatabaseCluster(customParentStack, 'CustomDatabase', {
        engine: rds.DatabaseClusterEngine.auroraPostgres({
          version: rds.AuroraPostgresEngineVersion.VER_16_1,
        }),
        writer: rds.ClusterInstance.provisioned('writer', {
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
        }),
        vpc: customVpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      });
      const customAsg = new autoscaling.AutoScalingGroup(customParentStack, 'CustomASG', {
        vpc: customVpc,
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3A, ec2.InstanceSize.MEDIUM),
        machineImage: ec2.MachineImage.latestAmazonLinux2023(),
        minCapacity: 3,
        maxCapacity: 3,
      });

      const fisStack = new FaultInjectionStack(customParentStack, 'FISStack', {
        azNames: customAzNames,
        azCount: 2,
        database: customDatabase,
        logGroupName: '/aws/fis/experiments',
        logGroupRetention: logs.RetentionDays.ONE_WEEK,
        autoScalingGroup: customAsg,
      });

      expect(fisStack.latencyExperiments.length).toBe(2);
      expect(fisStack.packetLossExperiments.length).toBe(2);
      expect(fisStack.cpuStressTestExperiments.length).toBe(2);
    });
  });

  describe('CloudFormation resources', () => {
    test('creates all required resource types', () => {
      sharedTemplate.resourceCountIs('AWS::FIS::ExperimentTemplate', 9); // 3 AZs * 3 experiment types
      sharedTemplate.resourceCountIs('AWS::Logs::LogGroup', 1);
      sharedTemplate.resourceCountIs('AWS::IAM::Role', 1);
      sharedTemplate.resourceCountIs('AWS::IAM::ManagedPolicy', 1);
    });
  });
});
