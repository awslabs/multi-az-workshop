// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface SelfManagedHttpEndpointS3StackProps extends cdk.NestedStackProps {
  readonly availabilityZoneIds: string[];
}

export class SelfManagedHttpEndpointS3Stack extends cdk.NestedStack {
  public readonly bucketUrl: string;
  public readonly bucket: s3.Bucket;
  public readonly resourcePath = '/';

  constructor(scope: Construct, id: string, props: SelfManagedHttpEndpointS3StackProps) {
    super(scope, id, props);

    this.bucket = new s3.Bucket(this, 'bucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: true,
        blockPublicPolicy: false,
        ignorePublicAcls: true,
        restrictPublicBuckets: false,
      }),
    });

    this.bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        effect: iam.Effect.ALLOW,
        principals: [new iam.AnyPrincipal()],
        resources: [this.bucket.bucketArn + '/*'],
        conditions: {
          StringEquals: {
            's3:ExistingObjectTag/public': 'true',
          },
        },
      }),
    );

    this.bucketUrl = 'https://' + this.bucket.bucketRegionalDomainName + '/';

    const runbookManagedPolicy = new iam.ManagedPolicy(this, 'runbookManagedPolicy', {
      path: '/az-evacuation/',
      statements: [
        new iam.PolicyStatement({
          actions: [
            's3:PutObject',
            's3:PutObjectTagging',
            's3:DeleteObject',
          ],
          effect: iam.Effect.ALLOW,
          resources: [this.bucket.bucketArn + '/*'],
        }),
      ],
    });

    const runbookRole = new iam.Role(this, 'runbookRole', {
      assumedBy: new iam.ServicePrincipal('ssm.amazonaws.com'),
      path: '/az-evacuation/',
      managedPolicies: [runbookManagedPolicy],
    });

    new ssm.CfnDocument(this, 'doc', {
      documentType: 'Automation',
      documentFormat: 'JSON',
      content: {
        schemaVersion: '0.3',
        assumeRole: runbookRole.roleArn,
        parameters: {
          AZ: {
            type: 'String',
            description: '(Required) The AZ to update.',
            allowedValues: props.availabilityZoneIds,
          },
          IsHealthy: {
            type: 'String',
            description: '(Required) Specifies whether the AZ should be considered healthy or not.',
            allowedValues: ['true', 'false'],
          },
        },
        mainSteps: [
          {
            name: 'DecideAction',
            action: 'aws:branch',
            inputs: {
              Choices: [
                {
                  NextStep: 'EvacuateAZ',
                  Variable: '{{IsHealthy}}',
                  StringEquals: 'false',
                },
                {
                  NextStep: 'RecoverAZ',
                  Variable: '{{IsHealthy}}',
                  StringEquals: 'true',
                },
              ],
            },
          },
          {
            name: 'EvacuateAZ',
            action: 'aws:executeScript',
            inputs: {
              Runtime: 'python3.8',
              Handler: 'handler',
              InputPayload: { AZ: '{{AZ}}', Bucket: this.bucket.bucketName },
              Script: cdk.Fn.join('\n', [
                'import boto3',
                "s3_client = boto3.client('s3')",
                'def handler(event, context):',
                "  return s3_client.put_object(Bucket=event['Bucket'], Key=event['AZ'], Body='', Tagging='public=true')",
              ]),
            },
            isEnd: true,
          },
          {
            name: 'RecoverAZ',
            action: 'aws:executeAwsApi',
            inputs: {
              Service: 's3',
              Api: 'DeleteObject',
              Bucket: this.bucket.bucketName,
              Key: '{{AZ}}',
            },
            isEnd: true,
          },
        ],
      },
    });
  }
}
