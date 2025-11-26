// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { NestedStackWithSource } from '../constructs/nested-stack-with-source';

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

  /**
   * Shared ECR uploader Lambda function
   */
  readonly uploaderFunction: lambda.IFunction;
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

    // Use the shared uploader Lambda function
    this.uploaderFunction = props.uploaderFunction;

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
                'AWS::URLSuffix',
              )}`,
              'output=$(docker load --input $file)',
              'echo $output',
              'IMAGE=$(echo $output | cut -d\':\' -f2 | xargs)',
              'echo $IMAGE',
              'VER=$(echo $output | cut -d\':\' -f3 | xargs)',
              'echo $VER',
              `docker tag \${IMAGE}:\${VER} $ACCOUNT.dkr.ecr.$AWS_REGION.${cdk.Fn.ref(
                'AWS::URLSuffix',
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

}
