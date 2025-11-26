// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface SelfManagedHttpEndpointApigStackProps extends cdk.NestedStackProps {
  /**
   * When set to true, if no record exists for the specified AZ ID, the
   * response will be considered healthy. This means that an AZ must explicitly
   * be set to unhealthy to fail the health check. If set to false, a missing
   * entry will be considered as unhealthy. This means that AZs must be
   * explicitly set to healthy.
   */
  readonly failOpen?: boolean;
  readonly availabilityZoneIds: string[];
}

export class SelfManagedHttpEndpointApigStack extends cdk.NestedStack {
  public readonly api: apigateway.RestApi;
  public readonly resourcePath: string;
  public readonly automationDocument: ssm.CfnDocument;

  constructor(scope: Construct, id: string, props: SelfManagedHttpEndpointApigStackProps) {
    super(scope, id, props);

    const failOpen = props.failOpen ?? true;

    const table = new dynamodb.Table(this, 'table', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      partitionKey: { name: 'AZ-ID', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const ddbManagedPolicy = new iam.ManagedPolicy(this, 'ddbManagedPolicy', {
      path: '/az-evacuation/',
      statements: [
        new iam.PolicyStatement({
          actions: [
            'dynamodb:GetItem',
            'dynamodb:UpdateItem',
            'dynamodb:PutItem',
          ],
          effect: iam.Effect.ALLOW,
          resources: [table.tableArn],
        }),
      ],
    });

    const apiGatewayRole = new iam.Role(this, 'executionRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      path: '/az-evacuation/',
      managedPolicies: [ddbManagedPolicy],
    });

    this.api = new apigateway.RestApi(this, 'api', {
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
      deploy: true,
      description: 'Provides an API resources can use to determine if a specific AZ ID is healthy',
      deployOptions: {
        variables: {
          failOpen: failOpen.toString(),
        },
      },
    });

    this.api.root
      .addResource('status')
      .addResource('{az-id}')
      .addMethod('GET', new apigateway.Integration({
        type: apigateway.IntegrationType.AWS,
        uri: cdk.Fn.sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:dynamodb:action/GetItem'),
        integrationHttpMethod: 'POST',
        options: {
          credentialsRole: apiGatewayRole,
          integrationResponses: [
            {
              statusCode: '200',
              responseTemplates: {
                'application/json': cdk.Fn.join('\n', [
                  '#set($inputRoot = $input.path(\'$\'))',
                  '$input.json(\'$\')',
                  '#if ($inputRoot.Item.Healthy[\'BOOL\'] == (false))',
                  '    #set($context.responseOverride.status = 500)',
                  '#end',
                  '#if (${stageVariables.failOpen} == "false" && ($inputRoot.isEmpty() || $inputRoot.Item.isEmpty() || !$inputRoot.Item.containsKey("Healthy")))',
                  '    #set($context.responseOverride.status = 500)',
                  '#end',
                ]),
              },
            },
          ],
          passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
          requestTemplates: {
            'application/json': cdk.Fn.sub(
              '{"TableName": "${Table}", "Key": {"AZ-ID": {"S" : "$input.params(\'az-id\')" } }, "ConsistentRead": true}',
              {
                Table: table.tableName,
              },
            ),
          },
        },
      }))
      .addMethodResponse({
        statusCode: '200',
      });

    this.resourcePath = cdk.Fn.join('', ['/', this.api.deploymentStage.stageName, '/status/']);

    const runbookManagedPolicy = new iam.ManagedPolicy(this, 'runbookManagedPolicy', {
      path: '/az-circuit-breaker/',
      statements: [
        new iam.PolicyStatement({
          actions: [
            'dynamodb:UpdateItem',
            'dynamodb:PutItem',
          ],
          effect: iam.Effect.ALLOW,
          resources: [table.tableArn],
        }),
      ],
    });

    const runbookRole = new iam.Role(this, 'runbookRole', {
      assumedBy: new iam.ServicePrincipal('ssm.amazonaws.com'),
      path: '/az-circuit-breaker/',
      managedPolicies: [runbookManagedPolicy],
    });

    this.automationDocument = new ssm.CfnDocument(this, 'doc', {
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
            type: 'Boolean',
            description: '(Required) Specifies whether the AZ should be considered healthy or not.',
            allowedValues: ['true', 'false'],
          },
        },
        mainSteps: [
          {
            name: 'UpdateAZ',
            action: 'aws:executeAwsApi',
            inputs: {
              Service: 'dynamodb',
              Api: 'UpdateItem',
              TableName: table.tableName,
              Key: {
                'AZ-ID': { S: '{{AZ}}' },
              },
              ExpressionAttributeValues: {
                ':h': { BOOL: '{{IsHealthy}}' },
                ':dt': { S: '{{global:DATE_TIME}}' },
                ':ex': { S: '{{automation:EXECUTION_ID}}' },
              },
              UpdateExpression: 'SET Healthy = :h, LastUpdate = :dt, ExecutionId = :ex',
            },
            isEnd: true,
          },
        ],
      },
    });
  }
}
