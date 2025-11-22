// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { NestedStackWithSource } from '../constructs/nested-stack-with-source';
import { EC2FleetStack } from './ec2-fleet-stack';

/**
 * Props for CodeDeploy Application Stack
 */
export interface CodeDeployApplicationStackProps extends cdk.NestedStackProps {
  /**
   * IAM resource path for CodeDeploy resources
   * @default '/codedeploy/'
   */
  readonly iamResourcePath?: string;

  /**
   * EC2 Fleet stack containing the target instances
   */
  readonly ec2Fleet: EC2FleetStack;

  /**
   * S3 key for the application deployment package
   */
  readonly applicationKey: string;

  /**
   * Total number of EC2 instances in the fleet
   */
  readonly totalEC2InstancesInFleet: number;

  /**
   * Number of availability zones
   */
  readonly availabilityZoneCount: number;

  /**
   * CloudWatch alarms to monitor during deployment
   */
  readonly alarms?: cloudwatch.IAlarm[];

  /**
   * Name of the CodeDeploy application
   */
  readonly applicationName: string;

  /**
   * Minimum number of healthy hosts per zone during deployment
   */
  readonly minimumHealthyHostsPerZone: number;
}

/**
 * Nested stack that creates a CodeDeploy application with zonal deployment configuration
 */
export class CodeDeployApplicationStack extends NestedStackWithSource {
  /**
   * The CodeDeploy server application
   */
  public readonly application: codedeploy.ServerApplication;

  /**
   * The zonal deployment group
   */
  public readonly frontEndDeploymentGroup: cdk.CfnResource;

  constructor(scope: cdk.Stack, id: string, props: CodeDeployApplicationStackProps) {
    super(scope, id, props);

    const iamResourcePath = props.iamResourcePath ?? '/codedeploy/';

    // Create managed policy for CodeDeploy
    const codedeployManagedPolicy = new iam.ManagedPolicy(this, 'CodeDeployManagedPolicy', {
      path: iamResourcePath,
      statements: [
        new iam.PolicyStatement({
          actions: [
            'ec2:RunInstances',
            'ec2:CreateTags',
            'iam:PassRole',
            'cloudwatch:DescribeAlarms',
          ],
          effect: iam.Effect.ALLOW,
          resources: ['*'],
        }),
      ],
    });

    // Create IAM role for CodeDeploy
    const role = new iam.Role(this, 'CodeDeployRole', {
      path: iamResourcePath,
      description: 'The IAM role used by CodeDeploy',
      assumedBy: new iam.ServicePrincipal('codedeploy.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromManagedPolicyArn(
          this,
          'ServiceRolePolicy',
          'arn:aws:iam::aws:policy/service-role/AWSCodeDeployRole'
        ),
        iam.ManagedPolicy.fromManagedPolicyArn(
          this,
          'ECSPolicy',
          'arn:aws:iam::aws:policy/AWSCodeDeployRoleForECS'
        ),
        iam.ManagedPolicy.fromManagedPolicyArn(
          this,
          'LambdaPolicy',
          'arn:aws:iam::aws:policy/service-role/AWSCodeDeployRoleForLambda'
        ),
        codedeployManagedPolicy,
      ],
    });

    // Create CodeDeploy application
    this.application = new codedeploy.ServerApplication(this, 'Application', {
      applicationName: props.applicationName,
    });

    // Create zonal deployment configuration
    // https://docs.aws.amazon.com/codedeploy/latest/userguide/instances-health.html#minimum-healthy-hosts
    const zonalDeploymentConfig = new codedeploy.CfnDeploymentConfig(this, 'ZonalConfig', {
      computePlatform: 'Server',
      zonalConfig: {
        firstZoneMonitorDurationInSeconds: 180,
        monitorDurationInSeconds: 60,
        minimumHealthyHostsPerZone: {
          type: 'HOST_COUNT',
          value: props.minimumHealthyHostsPerZone, // Only deploy to 1 at a time so canaries don't fail
        },
      },
      minimumHealthyHosts: {
        type: 'HOST_COUNT',
        value: Math.floor(props.totalEC2InstancesInFleet / props.availabilityZoneCount),
      },
    });

    // Create zonal deployment group
    const zonalDeploymentGroup = new codedeploy.CfnDeploymentGroup(this, 'ZonalDeploymentGroup', {
      applicationName: this.application.applicationName,
      serviceRoleArn: role.roleArn,
      deploymentGroupName: 'ZonalDeploymentGroup',
      loadBalancerInfo: {
        targetGroupInfoList: [
          {
            name: props.ec2Fleet.targetGroup.targetGroupName,
          },
        ],
      },
      deploymentConfigName: zonalDeploymentConfig.ref,
      deploymentStyle: {
        deploymentOption: 'WITH_TRAFFIC_CONTROL',
        deploymentType: 'IN_PLACE',
      },
      ec2TagFilters: [
        {
          key: 'aws:autoscaling:groupName',
          value: props.ec2Fleet.autoScalingGroup.autoScalingGroupName,
          type: 'KEY_AND_VALUE',
        },
      ],
      alarmConfiguration:
        props.alarms && props.alarms.length > 0
          ? {
              alarms: props.alarms.map((alarm) => ({
                name: alarm.alarmName,
              })),
              enabled: true,
            }
          : undefined,
    });

    // Create standard deployment group with initial deployment
    new codedeploy.CfnDeploymentGroup(this, 'DeploymentGroup', {
      applicationName: this.application.applicationName,
      serviceRoleArn: role.roleArn,
      autoScalingGroups: [props.ec2Fleet.autoScalingGroup.autoScalingGroupName],
      deploymentConfigName: codedeploy.ServerDeploymentConfig.ALL_AT_ONCE.deploymentConfigName,
      loadBalancerInfo: {
        targetGroupInfoList: [
          {
            name: props.ec2Fleet.targetGroup.targetGroupName,
          },
        ],
      },
      deployment: {
        revision: {
          revisionType: 'S3',
          s3Location: {
            bucket: cdk.Fn.ref('AssetsBucketName'),
            key: props.applicationKey,
            bundleType: 'zip',
          },
        },
        ignoreApplicationStopFailures: true,
      },
      deploymentStyle: {
        deploymentOption: 'WITH_TRAFFIC_CONTROL',
        deploymentType: 'IN_PLACE',
      },
    });

    this.frontEndDeploymentGroup = zonalDeploymentGroup;
  }
}
