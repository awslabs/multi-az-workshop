// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/// <reference types="node" />

import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Props for adding a container and repository
 */
export interface RepoAndContainerProps {
  /**
   * Name of the ECR repository
   */
  readonly repositoryName: string;

  /**
   * S3 object key for the container image
   */
  readonly containerImageS3ObjectKey: string;
}

/**
 * Props for creating a repository and Helm chart
 */
export interface RepoAndHelmChartProps {
  /**
   * Name of the ECR repository
   */
  readonly repositoryName: string;

  /**
   * Name of the Helm chart
   */
  readonly helmChartName: string;

  /**
   * Version of the Helm chart
   */
  readonly version: string;
}

/**
 * Response containing a waitable dependency and repository
 */
export interface WaitableResponse {
  /**
   * Dependency that can be waited on
   */
  readonly dependable: cdk.CustomResource;

  /**
   * ECR repository
   */
  readonly repository: ecr.Repository;
}

/**
 * Construct for managing container images and ECR repositories
 */
export class ContainerAndRepo extends Construct {
  public readonly uploaderFunction: lambda.IFunction;
  public readonly containerBuildProject: codebuild.IProject;

  constructor(scope: Construct, id: string, pythonRuntime: lambda.Runtime) {
    super(scope, id);

    this.uploaderFunction = this.setupUploader(pythonRuntime);
    this.containerBuildProject = this.setupContainerBuildProject();
  }

  /**
   * Creates a new ECR repository and uploads a container image to the repo
   */
  public addContainerAndRepo(props: RepoAndContainerProps): WaitableResponse {
    const applicationRepo = new ecr.Repository(this, props.repositoryName.replace(/\//g, '-') + '-repo', {
      emptyOnDelete: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      repositoryName: props.repositoryName,
    });

    const appContainerImage = new cdk.CustomResource(
      this,
      props.repositoryName.replace(/\//g, '-') + '-container',
      {
        serviceToken: this.uploaderFunction.functionArn,
        properties: {
          Type: 'Docker',
          Bucket: cdk.Fn.ref('AssetsBucketName'),
          Key: cdk.Fn.ref('AssetsBucketPrefix') + props.containerImageS3ObjectKey,
          ProjectName: this.containerBuildProject.projectName,
          Repository: applicationRepo.repositoryName,
          Nonce: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
        },
      }
    );

    appContainerImage.node.addDependency(this.uploaderFunction);
    appContainerImage.node.addDependency(this.containerBuildProject);

    return {
      dependable: appContainerImage,
      repository: applicationRepo,
    };
  }

  /**
   * Creates a repository and uploads a Helm chart
   */
  public createRepoAndHelmChart(props: RepoAndHelmChartProps): WaitableResponse {
    const repo = new ecr.Repository(this, props.helmChartName + '-repo', {
      emptyOnDelete: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      repositoryName: props.repositoryName,
    });

    const chart = new cdk.CustomResource(this, props.helmChartName + '-helm-chart', {
      serviceToken: this.uploaderFunction.functionArn,
      properties: {
        Type: 'Helm',
        Bucket: cdk.Fn.ref('AssetsBucketName'),
        Key: cdk.Fn.ref('AssetsBucketPrefix') + props.helmChartName + '-' + props.version + '.tgz',
        Repository: repo.repositoryName,
      },
    });

    chart.node.addDependency(this.uploaderFunction);

    return {
      dependable: chart,
      repository: repo,
    };
  }

  private setupUploader(pythonRuntime: lambda.Runtime): lambda.IFunction {
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

    const uploaderRole = new iam.Role(this, 'UploaderRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [uploaderPolicy],
    });

    const helmLayerPath = path.join(process.cwd(), 'helm-layer.zip');
    const uploaderSrcPath = path.join(process.cwd(), 'uploader-src', 'index.py');

    const uploader = new lambda.Function(this, 'EcrUploader', {
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      memorySize: 512,
      timeout: cdk.Duration.seconds(300),
      runtime: pythonRuntime,
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

    const logGroup = new logs.LogGroup(this, 'logGroup', {
      logGroupName: `/aws/lambda/${uploader.functionName}`,
      retention: logs.RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

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

  private setupContainerBuildProject(): codebuild.IProject {
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

    new logs.LogGroup(this, 'BuildProjectLogGroup', {
      logGroupName: '/aws/codebuild/' + containerBuild.projectName,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    return containerBuild;
  }
}
