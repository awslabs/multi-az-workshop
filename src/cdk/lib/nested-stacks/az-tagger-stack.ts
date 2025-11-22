// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { NestedStackWithSource } from '../constructs/nested-stack-with-source';

/**
 * Nested stack that creates a Lambda function to tag EC2 instances with their availability zone
 */
export class AZTaggerStack extends NestedStackWithSource {
  /**
   * ARN of the AZ tagger Lambda function
   */
  public readonly functionArn: string;

  constructor(scope: cdk.Stack, id: string, props?: cdk.NestedStackProps) {
    super(scope, id, props);

    // Create managed policy for X-Ray
    const xrayManagedPolicy = new iam.ManagedPolicy(this, 'xrayManagedPolicy', {
      path: '/aztagger/',
      statements: [
        new iam.PolicyStatement({
          actions: [
            'xray:PutTraceSegments',
            'xray:PutTelemetryRecords',
            'xray:GetSamplingRules',
            'xray:GetSamplingTargets',
            'xray:GetSamplingStatisticSummaries',
          ],
          effect: iam.Effect.ALLOW,
          resources: ['*'],
        }),
      ],
    });

    // Create managed policy for EC2
    const ec2ManagedPolicy = new iam.ManagedPolicy(this, 'ec2ManagedPolicy', {
      path: '/aztagger/',
      statements: [
        new iam.PolicyStatement({
          actions: [
            'ec2:DescribeAvailabilityZones',
            'ec2:DescribeTags',
            'ec2:CreateTags',
            'ec2:DescribeInstances',
          ],
          effect: iam.Effect.ALLOW,
          resources: ['*'],
        }),
      ],
    });

    // Create execution role for Lambda
    const executionRole = new iam.Role(this, 'executionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      path: '/aztagger/',
      managedPolicies: [xrayManagedPolicy, ec2ManagedPolicy],
    });

    // Create Lambda function from asset
    const azTagger = new lambda.Function(this, 'azTagger', {
      runtime: lambda.Runtime.PYTHON_3_13,
      code: lambda.Code.fromAsset('src/cdk/az-tagger-src'),
      handler: 'index.handler',
      role: executionRole,
      architecture: lambda.Architecture.ARM_64,
      tracing: lambda.Tracing.ACTIVE,
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      environment: {
        REGION: cdk.Fn.ref('AWS::Region'),
        PARTITION: cdk.Fn.ref('AWS::Partition'),
      },
    });

    this.functionArn = azTagger.functionArn;

    // Grant Lambda invoke permission to EventBridge
    azTagger.addPermission('invokePermission', {
      action: 'lambda:InvokeFunction',
      principal: new iam.ServicePrincipal('events.amazonaws.com'),
      sourceArn: cdk.Fn.sub('arn:${AWS::Partition}:events:${AWS::Region}:${AWS::AccountId}:rule/*'),
    });

    // Create log group
    const logGroup = new logs.LogGroup(this, 'logGroup', {
      logGroupName: `/aws/lambda/${azTagger.functionName}`,
      retention: logs.RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create managed policy for CloudWatch Logs
    new iam.ManagedPolicy(this, 'cwManagedPolicy', {
      path: '/azmapper/',
      statements: [
        new iam.PolicyStatement({
          actions: ['cloudwatch:PutMetricData'],
          effect: iam.Effect.ALLOW,
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          effect: iam.Effect.ALLOW,
          resources: [logGroup.logGroupArn],
        }),
      ],
      roles: [executionRole],
    });

    // Create EventBridge rule for EC2 instance launch
    new events.Rule(this, 'ec2Launch', {
      eventPattern: {
        source: ['aws.ec2'],
        detailType: ['EC2 Instance State-change Notification'],
        detail: {
          state: ['pending'],
        },
      },
      enabled: true,
      targets: [new targets.LambdaFunction(azTagger)],
    });
  }
}
