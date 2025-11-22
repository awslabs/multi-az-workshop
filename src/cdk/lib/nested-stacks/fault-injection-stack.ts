// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as fis from 'aws-cdk-lib/aws-fis';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';

/**
 * Props for Fault Injection Stack
 */
export interface FaultInjectionStackProps extends cdk.NestedStackProps {
  /**
   * Array of availability zone names
   */
  readonly azNames: string[];

  /**
   * Number of availability zones
   */
  readonly azCount: number;

  /**
   * Database cluster to target for fault injection
   */
  readonly database: rds.DatabaseCluster;

  /**
   * Name for the CloudWatch log group
   */
  readonly logGroupName: string;

  /**
   * Retention period for the log group
   */
  readonly logGroupRetention: logs.RetentionDays;

  /**
   * Network interface name (e.g., 'ens5' or 'eth0')
   * @default 'ens5'
   */
  readonly interface?: string;

  /**
   * Auto Scaling Group to target for fault injection
   */
  readonly autoScalingGroup: autoscaling.IAutoScalingGroup;

  /**
   * Log schema version for FIS experiments
   * @default 2
   */
  readonly logSchemaVersion?: number;

  /**
   * Delay in milliseconds for latency experiments
   * @default Duration.millis(100)
   */
  readonly delayMilliseconds?: cdk.Duration;

  /**
   * Packet loss percentage for packet loss experiments
   * @default 10
   */
  readonly packetLossPercent?: number;
}

/**
 * Nested stack that creates AWS Fault Injection Simulator (FIS) experiment templates
 * for testing application resilience
 */
export class FaultInjectionStack extends cdk.NestedStack {
  /**
   * Array of latency experiment templates (one per AZ)
   */
  public readonly latencyExperiments: fis.CfnExperimentTemplate[];

  /**
   * Array of packet loss experiment templates (one per AZ)
   */
  public readonly packetLossExperiments: fis.CfnExperimentTemplate[];

  /**
   * Array of CPU stress test experiment templates (one per AZ)
   */
  public readonly cpuStressTestExperiments: fis.CfnExperimentTemplate[];

  /**
   * CloudWatch log group for FIS experiment logs
   */
  public readonly logGroup: logs.ILogGroup;

  constructor(scope: cdk.Stack, id: string, props: FaultInjectionStackProps) {
    super(scope, id, props);

    const networkInterface = props.interface ?? 'ens5';
    const logSchemaVersion = props.logSchemaVersion ?? 2;
    const delayMilliseconds = props.delayMilliseconds ?? cdk.Duration.millis(100);
    const packetLossPercent = props.packetLossPercent ?? 10;

    // Create CloudWatch log group for FIS experiments
    this.logGroup = new logs.LogGroup(this, 'logGroup', {
      logGroupName: props.logGroupName,
      retention: props.logGroupRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create managed policy for CloudWatch Logs access
    const cloudWatchManagedPolicy = new iam.ManagedPolicy(this, 'cwManagedPolicy', {
      description: 'Allows FIS to write CWL',
      statements: [
        new iam.PolicyStatement({
          actions: [
            'logs:CreateLogStream',
            'logs:PutLogEvents',
            'logs:DescribeLogGroups',
            'logs:DescribeLogStreams',
          ],
          effect: iam.Effect.ALLOW,
          resources: [cdk.Fn.sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:*')],
        }),
        new iam.PolicyStatement({
          actions: [
            'logs:GetDelivery',
            'logs:GetDeliverySource',
            'logs:PutDeliveryDestination',
            'logs:GetDeliveryDestinationPolicy',
            'logs:DeleteDeliverySource',
            'logs:PutDeliveryDestinationPolicy',
            'logs:CreateDelivery',
            'logs:GetDeliveryDestination',
            'logs:PutDeliverySource',
            'logs:DeleteDeliveryDestination',
            'logs:DeleteDeliveryDestinationPolicy',
            'logs:DeleteDelivery',
          ],
          effect: iam.Effect.ALLOW,
          resources: [
            cdk.Fn.sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:delivery:*'),
            cdk.Fn.sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:delivery-source:*'),
            cdk.Fn.sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:delivery-destination:*'),
          ],
        }),
        new iam.PolicyStatement({
          actions: [
            'logs:DescribeDeliveryDestinations',
            'logs:DescribeDeliverySources',
            'logs:DescribeDeliveries',
            'logs:CreateLogDelivery',
          ],
          effect: iam.Effect.ALLOW,
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          actions: ['logs:PutResourcePolicy', 'logs:DescribeResourcePolicies', 'logs:DescribeLogGroups'],
          effect: iam.Effect.ALLOW,
          resources: [cdk.Fn.sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:*')],
        }),
      ],
    });

    // Create IAM role for FIS
    const role = new iam.Role(this, 'FISRole', {
      description: 'The IAM role used by FIS',
      assumedBy: new iam.ServicePrincipal('fis.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSFaultInjectionSimulatorEC2Access'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSFaultInjectionSimulatorECSAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSFaultInjectionSimulatorEKSAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSFaultInjectionSimulatorNetworkAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSFaultInjectionSimulatorRDSAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSFaultInjectionSimulatorSSMAccess'),
        cloudWatchManagedPolicy,
      ],
    });

    // Override the assume role policy to add conditions
    const cfnRole = role.node.defaultChild as iam.CfnRole;
    cfnRole.assumeRolePolicyDocument = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            Service: ['fis.amazonaws.com'],
          },
          Action: 'sts:AssumeRole',
          Condition: {
            StringEquals: {
              'aws:SourceAccount': cdk.Fn.ref('AWS::AccountId'),
            },
            ArnLike: {
              'aws:SourceArn': cdk.Fn.sub('arn:${AWS::Partition}:fis:${AWS::Region}:${AWS::AccountId}:experiment/*'),
            },
          },
        },
      ],
    };

    // Initialize experiment template arrays
    this.latencyExperiments = [];
    this.packetLossExperiments = [];
    this.cpuStressTestExperiments = [];

    // Create experiment templates for each availability zone
    for (let i = 0; i < props.azCount; i++) {
      const azName = cdk.Fn.select(i, props.azNames);

      // Latency experiment template
      const latencyExperiment = new fis.CfnExperimentTemplate(this, `az${i}LatencyTemplate`, {
        roleArn: role.roleArn,
        description: 'Adds latency EC2 instances connecting to the database',
        actions: {
          addLatency: {
            actionId: 'aws:ssm:send-command',
            parameters: {
              documentArn: cdk.Fn.sub('arn:${AWS::Partition}:ssm:${AWS::Region}::document/AWSFIS-Run-Network-Latency-Sources'),
              documentParameters: JSON.stringify({
                Interface: networkInterface,
                DelayMilliseconds: delayMilliseconds.toMilliseconds().toString(),
                JitterMilliseconds: '10',
                Sources: props.database.clusterEndpoint.hostname,
                TrafficType: 'egress',
                InstallDependencies: 'True',
                DurationSeconds: '3600',
              }),
              duration: 'PT60M',
            },
            targets: {
              Instances: 'oneAZ',
            },
          },
        },
        targets: {
          oneAZ: {
            filters: [
              {
                path: 'Placement.AvailabilityZone',
                values: [azName],
              },
            ],
            resourceTags: {
              'aws:autoscaling:groupName': props.autoScalingGroup.autoScalingGroupName,
            },
            selectionMode: 'ALL',
            resourceType: 'aws:ec2:instance',
          },
        },
        stopConditions: [
          {
            source: 'none',
          },
        ],
        tags: {
          Name: `Add Latency to ${azName}`,
        },
        logConfiguration: {
          cloudWatchLogsConfiguration: {
            logGroupArn: this.logGroup.logGroupArn,
          },
          logSchemaVersion,
        },
      });

      // Fix the CloudWatch Logs configuration property name
      latencyExperiment.addOverride('Properties.LogConfiguration.CloudWatchLogsConfiguration.LogGroupArn', this.logGroup.logGroupArn);
      latencyExperiment.addOverride('Properties.LogConfiguration.CloudWatchLogsConfiguration.logGroupArn', undefined);

      this.latencyExperiments.push(latencyExperiment);

      // Packet loss experiment template
      const packetLossExperiment = new fis.CfnExperimentTemplate(this, `az${i}PacketLossTemplate`, {
        roleArn: role.roleArn,
        description: 'Drops packets from EC2 instances connecting to the database',
        actions: {
          packetLoss: {
            actionId: 'aws:ssm:send-command',
            parameters: {
              documentArn: cdk.Fn.sub('arn:${AWS::Partition}:ssm:${AWS::Region}::document/AWSFIS-Run-Network-Packet-Loss-Sources'),
              documentParameters: JSON.stringify({
                Interface: networkInterface,
                LossPercent: packetLossPercent.toString(),
                Sources: props.database.clusterEndpoint.hostname,
                TrafficType: 'egress',
                InstallDependencies: 'True',
                DurationSeconds: '3600',
              }),
              duration: 'PT60M',
            },
            targets: {
              Instances: 'oneAZ',
            },
          },
        },
        targets: {
          oneAZ: {
            filters: [
              {
                path: 'Placement.AvailabilityZone',
                values: [azName],
              },
            ],
            resourceTags: {
              'aws:autoscaling:groupName': props.autoScalingGroup.autoScalingGroupName,
            },
            selectionMode: 'ALL',
            resourceType: 'aws:ec2:instance',
          },
        },
        stopConditions: [
          {
            source: 'none',
          },
        ],
        tags: {
          Name: `Add Packet Loss to ${azName}`,
        },
        logConfiguration: {
          cloudWatchLogsConfiguration: {
            logGroupArn: this.logGroup.logGroupArn,
          },
          logSchemaVersion,
        },
      });

      // Fix the CloudWatch Logs configuration property name
      packetLossExperiment.addOverride('Properties.LogConfiguration.CloudWatchLogsConfiguration.LogGroupArn', this.logGroup.logGroupArn);
      packetLossExperiment.addOverride('Properties.LogConfiguration.CloudWatchLogsConfiguration.logGroupArn', undefined);

      this.packetLossExperiments.push(packetLossExperiment);

      // CPU stress test experiment template
      const cpuStressExperiment = new fis.CfnExperimentTemplate(this, `az${i}CpuStressTestTemplate`, {
        roleArn: role.roleArn,
        description: 'Runs CPU stress on EC2 instances',
        actions: {
          cpuStress: {
            actionId: 'aws:ssm:send-command',
            parameters: {
              documentArn: cdk.Fn.sub('arn:${AWS::Partition}:ssm:${AWS::Region}::document/AWSFIS-Run-CPU-Stress'),
              documentParameters: JSON.stringify({
                DurationSeconds: '3600',
              }),
              duration: 'PT60M',
            },
            targets: {
              Instances: 'oneAZ',
            },
          },
        },
        targets: {
          oneAZ: {
            filters: [
              {
                path: 'Placement.AvailabilityZone',
                values: [azName],
              },
            ],
            resourceTags: {
              'aws:autoscaling:groupName': props.autoScalingGroup.autoScalingGroupName,
            },
            selectionMode: 'ALL',
            resourceType: 'aws:ec2:instance',
          },
        },
        stopConditions: [
          {
            source: 'none',
          },
        ],
        tags: {
          Name: `Add CPU stress to instances in ${azName}`,
        },
        logConfiguration: {
          cloudWatchLogsConfiguration: {
            logGroupArn: this.logGroup.logGroupArn,
          },
          logSchemaVersion,
        },
      });

      // Fix the CloudWatch Logs configuration property name
      cpuStressExperiment.addOverride('Properties.LogConfiguration.CloudWatchLogsConfiguration.LogGroupArn', this.logGroup.logGroupArn);
      cpuStressExperiment.addOverride('Properties.LogConfiguration.CloudWatchLogsConfiguration.logGroupArn', undefined);

      this.cpuStressTestExperiments.push(cpuStressExperiment);
    }
  }
}
