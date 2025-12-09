// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as fs from 'fs';
import * as path from 'path';

export interface EcrUploaderStackProps extends cdk.NestedStackProps {
  readonly pythonRuntime: lambda.Runtime;
}

/**
 * Nested stack that creates a shared ECR uploader Lambda function
 */
export class EcrUploaderStack extends cdk.NestedStack {
  public readonly uploaderFunction: lambda.IFunction;

  constructor(scope: Construct, id: string, props: EcrUploaderStackProps) {
    super(scope, id, props);

    // Create IAM policy for the uploader
    const uploaderPolicy = new iam.ManagedPolicy(this, 'UploaderPolicy', {
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['s3:GetObject'],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['kms:Decrypt'],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'ecr:CompleteLayerUpload',
            'ecr:UploadLayerPart',
            'ecr:InitiateLayerUpload',
            'ecr:BatchCheckLayerAvailability',
            'ecr:PutImage',
            'ecr:DescribeImages',
            'ecr:DescribeRepositories',
            'ecr:GetAuthorizationToken',
            'ecr:BatchGetImage',
          ],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['codebuild:StartBuild', 'codebuild:ListBuildsForProject', 'codebuild:BatchGetBuilds'],
          resources: ['*'],
        }),
      ],
    });

    // Create IAM role for the uploader
    const uploaderRole = new iam.Role(this, 'UploaderRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [uploaderPolicy],
    });

    const helmLayerPath = path.join(process.cwd(), 'assets', 'helm-layer.zip');
    const uploaderSrcPath = path.join(process.cwd(), 'src', 'cdk', 'uploader-src', 'index.py');

    // Create the Lambda function
    this.uploaderFunction = new lambda.Function(this, 'EcrUploader', {
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      memorySize: 512,
      timeout: cdk.Duration.seconds(300),
      runtime: props.pythonRuntime,
      role: uploaderRole,
      environment: {
        AWS_ACCOUNT_ID: cdk.Fn.ref('AWS::AccountId'),
      },
      layers: [
        new lambda.LayerVersion(this, 'HelmLayer', {
          code: lambda.Code.fromAsset(helmLayerPath),
        }),
      ],
      code: lambda.Code.fromInline(fs.readFileSync(uploaderSrcPath, 'utf-8')),
    });

    // Create log group for the Lambda function
    const logGroup = new logs.LogGroup(this, 'logGroup', {
      logGroupName: `/aws/lambda/${this.uploaderFunction.functionName}`,
      retention: logs.RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Add CloudWatch logging permissions
    new iam.ManagedPolicy(this, 'CloudWatchManagedPolicy', {
      statements: [
        new iam.PolicyStatement({
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          effect: iam.Effect.ALLOW,
          resources: [logGroup.logGroupArn],
        }),
        new iam.PolicyStatement({
          actions: ['logs:CreateLogGroup'],
          effect: iam.Effect.ALLOW,
          resources: ['*'],
        }),
      ],
      roles: [uploaderRole],
    });

    // Output the function ARN
    new cdk.CfnOutput(this, 'UploaderFunctionArn', {
      value: this.uploaderFunction.functionArn,
      description: 'ARN of the ECR uploader Lambda function',
    });
  }
}
