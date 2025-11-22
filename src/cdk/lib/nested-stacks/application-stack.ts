// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as fs from 'fs';
import { NestedStackWithSource } from '../constructs/nested-stack-with-source';
import { MultiAZWorkshopStack } from '../multi-az-workshop-stack';

/**
 * Props for Application Stack
 */
export interface ApplicationStackProps extends cdk.NestedStackProps {
  /**
   * S3 object key for the container image
   */
  readonly containerImageObjectKey: string;

  /**
   * S3 object key for the container image with fault injection
   */
  readonly containerImageWithFaultObjectKey: string;
}

/**
 * Nested stack that creates container repositories and build infrastructure
 */
export class ApplicationStack extends NestedStackWithSource {
  /**
   * URI of the application container image
   */
  public readonly applicationImage: string;

  /**
   * URI of the application container image with fault injection
   */
  public readonly applicationFaultImage: string;

  /**
   * URI of the CloudWatch agent container image
   */
  public readonly cloudwatchContainerImage: string;

  /**
   * Lambda function for uploading container images
   */
  public readonly uploaderFunction: lambda.IFunction;

  /**
   * CodeBuild project for building containers
   */
  public readonly containerBuildProject: codebuild.IProject;

  constructor(scope: cdk.Stack, id: string, props: ApplicationStackProps) {
    super(scope, id, props);

    // Set up the uploader Lambda function
    this.uploaderFunction = this.setupUploader();

    // Set up the container build project
    this.containerBuildProject = this.setupContainerBuildProject();

    // Create the repository for the application container
    const applicationRepo = new ecr.Repository(this, 'AppContainerImageRepo', {
      emptyOnDelete: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      repositoryName: 'multi-az-workshop',
    });

    this.applicationImage = `${applicationRepo.repositoryUri}:latest`;

    // Create custom resource to upload application container
    new cdk.CustomResource(this, 'AppContainer', {
      serviceToken: this.uploaderFunction.functionArn,
      properties: {
        Type: 'Docker',
        Bucket: cdk.Fn.ref('AssetsBucketName'),
        Key: cdk.Fn.ref('AssetsBucketPrefix') + props.containerImageObjectKey,
        ProjectName: this.containerBuildProject.projectName,
        Repository: applicationRepo.repositoryName,
        Nonce: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
      },
    });

    this.applicationFaultImage = `${applicationRepo.repositoryUri}:fail`;

    // Create custom resource to upload application container with fault
    new cdk.CustomResource(this, 'AppFaultContainer', {
      serviceToken: this.uploaderFunction.functionArn,
      properties: {
        Type: 'Docker',
        Bucket: cdk.Fn.ref('AssetsBucketName'),
        Key: cdk.Fn.ref('AssetsBucketPrefix') + props.containerImageWithFaultObjectKey,
        ProjectName: this.containerBuildProject.projectName,
        Repository: applicationRepo.repositoryName,
        Nonce: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
      },
    });

    // Create repository for CloudWatch agent
    const cloudwatchAgentRepo = new ecr.Repository(this, 'CloudWatchAgentRepository', {
      emptyOnDelete: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      repositoryName: 'cloudwatch-agent/cloudwatch-agent',
    });

    this.cloudwatchContainerImage = `${cloudwatchAgentRepo.repositoryUri}:latest`;

    // Create custom resource to upload CloudWatch agent container
    new cdk.CustomResource(this, 'CloudWatchAgentContainerImage', {
      serviceToken: this.uploaderFunction.functionArn,
      properties: {
        Type: 'Docker',
        Bucket: cdk.Fn.ref('AssetsBucketName'),
        Key: cdk.Fn.ref('AssetsBucketPrefix') + 'cloudwatch-agent.tar.gz',
        ProjectName: this.containerBuildProject.projectName,
        Repository: cloudwatchAgentRepo.repositoryName,
      },
    });
  }

  /**
   * Sets up the CodeBuild project for building and pushing container images
   */
  private setupContainerBuildProject(): codebuild.IProject {
    // This will download the container tar.gz from S3, unzip it, then push to the ECR repository
    const containerBuild = new codebuild.Project(this, 'AppBuild', {
      environment: {
        buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
        privileged: true,
      },
      buildSpec: codebuild.BuildSpec.fromObjectToYaml({
        version: '0.2',
        phases: {
          build: {
            commands: [
              'ACCOUNT=$(echo $CODEBUILD_BUILD_ARN | cut -d\':\' -f5)',
              'echo $ACCOUNT',
              'echo $BUCKET',
              'echo $KEY',
              'file=${KEY#*/}',
              'echo $file',
              'aws s3 cp s3://$BUCKET/$KEY $file',
              `aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$AWS_REGION.${cdk.Fn.ref(
                'AWS::URLSuffix'
              )}`,
              'output=$(docker load --input $file)',
              'echo $output',
              'IMAGE=$(echo $output | cut -d\':\' -f2 | xargs)',
              'echo $IMAGE',
              'VER=$(echo $output | cut -d\':\' -f3 | xargs)',
              'echo $VER',
              `docker tag \${IMAGE}:\${VER} $ACCOUNT.dkr.ecr.$AWS_REGION.${cdk.Fn.ref(
                'AWS::URLSuffix'
              )}/\${REPO}:\${VER}`,
              `docker push $ACCOUNT.dkr.ecr.$AWS_REGION.${cdk.Fn.ref('AWS::URLSuffix')}/\${REPO}:\${VER}`,
            ],
          },
        },
      }),
      role: new iam.Role(this, 'CodeBuildRole', {
        assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
        managedPolicies: [
          new iam.ManagedPolicy(this, 'CodeBuildPolicy', {
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                resources: ['*'],
                actions: [
                  's3:GetObject',
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
              }),
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                resources: ['*'],
                actions: ['kms:Decrypt'],
              }),
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                resources: ['*'],
                actions: [
                  'codebuild:CreateReportGroup',
                  'codebuild:CreateReport',
                  'codebuild:UpdateReport',
                  'codebuild:BatchPutTestCases',
                  'codebuild:BatchPutCodeCoverages',
                ],
              }),
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                resources: ['*'],
                actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
              }),
            ],
          }),
        ],
      }),
    });

    // Create log group for the build project
    new logs.LogGroup(this, 'BuildProjectLogGroup', {
      logGroupName: `/aws/codebuild/${containerBuild.projectName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    return containerBuild;
  }

  /**
   * Sets up the Lambda function for uploading container images to ECR
   */
  private setupUploader(): lambda.IFunction {
    // Create managed policy for the uploader
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

    // Create the Lambda function
    const uploader = new lambda.Function(this, 'EcrUploader', {
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      memorySize: 512,
      timeout: cdk.Duration.seconds(300),
      runtime: MultiAZWorkshopStack.pythonRuntime,
      role: uploaderRole,
      environment: {
        AWS_ACCOUNT_ID: cdk.Fn.ref('AWS::AccountId'),
      },
      layers: [
        new lambda.LayerVersion(this, 'HelmLayer', {
          code: lambda.Code.fromAsset('helm-layer.zip'),
        }),
      ],
      code: lambda.Code.fromInline(fs.readFileSync('./uploader-src/index.py', 'utf-8')),
    });

    // Create log group for the Lambda function
    const logGroup = new logs.LogGroup(this, 'logGroup', {
      logGroupName: `/aws/lambda/${uploader.functionName}`,
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

    return uploader;
  }
}
