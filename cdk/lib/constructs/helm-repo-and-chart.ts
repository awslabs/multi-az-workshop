// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

/**
 * Abstract base construct for creating Helm repositories and charts
 */
export abstract class HelmRepoAndChartConstruct extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);
  }

  /**
   * Creates a Helm repository and uploads a chart to it
   * @param name Name of the Helm chart
   * @param version Version of the Helm chart
   * @param functionArn ARN of the Lambda function to use for uploading
   * @returns The ECR repository
   */
  protected createHelmRepoAndChart(name: string, version: string, functionArn: string): ecr.Repository {
    const repo = new ecr.Repository(this, name + 'HelmRepo', {
      emptyOnDelete: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      repositoryName: name,
    });

    new cdk.CustomResource(this, name + 'HelmChart', {
      serviceToken: functionArn,
      properties: {
        Type: 'Helm',
        Bucket: cdk.Fn.ref('AssetsBucketName'),
        Key: cdk.Fn.ref('AssetsBucketPrefix') + name + '-' + version + '.tgz',
        Repository: repo.repositoryName,
      },
    });

    return repo;
  }
}
