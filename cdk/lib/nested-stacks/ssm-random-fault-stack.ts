// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as fis from 'aws-cdk-lib/aws-fis';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as fs from 'fs';
import * as path from 'path';
import { NestedStackWithSource } from '../constructs/nested-stack-with-source';

/**
 * Props for SSM Random Fault Stack
 */
export interface SSMRandomFaultStackProps extends cdk.NestedStackProps {
  /**
   * Array of latency experiment templates
   */
  readonly latencyExperiments: fis.CfnExperimentTemplate[];

  /**
   * Array of packet loss experiment templates
   */
  readonly packetLossExperiments: fis.CfnExperimentTemplate[];
}

/**
 * Nested stack that creates SSM automation documents for randomly triggering
 * fault injection experiments
 */
export class SSMRandomFaultStack extends NestedStackWithSource {
  constructor(scope: cdk.Stack, id: string, props: SSMRandomFaultStackProps) {
    super(scope, id, props);

    // Create managed policy for FIS experiment execution
    const fisManagedPolicy = new iam.ManagedPolicy(this, 'fisManagedPolicy', {
      description: 'Allows SSM to start an experiment',
      statements: [
        new iam.PolicyStatement({
          actions: ['fis:StartExperiment'],
          effect: iam.Effect.ALLOW,
          resources: [
            ...props.latencyExperiments.map((exp) =>
              cdk.Fn.sub('arn:${AWS::Partition}:fis:${AWS::Region}:${AWS::AccountId}:experiment-template/${id}', {
                id: exp.ref,
              })
            ),
            ...props.packetLossExperiments.map((exp) =>
              cdk.Fn.sub('arn:${AWS::Partition}:fis:${AWS::Region}:${AWS::AccountId}:experiment-template/${id}', {
                id: exp.ref,
              })
            ),
            cdk.Fn.sub('arn:${AWS::Partition}:fis:${AWS::Region}:${AWS::AccountId}:experiment/*'),
          ],
        }),
        new iam.PolicyStatement({
          actions: [
            'codedeploy:CreateDeployment',
            'codedeploy:GetApplicationRevision',
            'codedeploy:GetDeploymentConfig',
            'codedeploy:RegisterApplicationRevision',
          ],
          effect: iam.Effect.ALLOW,
          resources: ['*'],
        }),
      ],
    });

    // Create IAM role for SSM automation
    const role = new iam.Role(this, 'SSMRole', {
      description: 'The IAM role used by ssm to start an experiment',
      assumedBy: new iam.ServicePrincipal('ssm.amazonaws.com'),
      managedPolicies: [fisManagedPolicy],
    });

    // Read the Python scripts from the Configs directory
    const faultInjectorScript = fs.readFileSync(path.join(__dirname, '../../Configs/fault-injector.py'), 'utf8');
    const latencyExperimentScript = fs.readFileSync(path.join(__dirname, '../../Configs/start-latency-experiment.py'), 'utf8');
    const packetLossExperimentScript = fs.readFileSync(path.join(__dirname, '../../Configs/start-packet-loss-experiment.py'), 'utf8');

    // Create SSM document for random fault selection
    new ssm.CfnDocument(this, 'randomFaultSelect', {
      documentType: 'Automation',
      documentFormat: 'YAML',
      content: {
        schemaVersion: '0.3',
        assumeRole: role.roleArn,
        parameters: {
          LatencyExperiments: {
            type: 'StringList',
            minItems: 1,
            description: '(Required) The latency experiment templates to choose from',
            default: props.latencyExperiments.map((exp) => exp.ref),
          },
          PacketLossExperiments: {
            type: 'StringList',
            minItems: 1,
            description: '(Required) The latency experiment templates to choose from',
            default: props.packetLossExperiments.map((exp) => exp.ref),
          },
        },
        mainSteps: [
          {
            name: 'StartExperiment',
            action: 'aws:executeScript',
            inputs: {
              Runtime: 'python3.11',
              Handler: 'handler',
              InputPayload: {
                LatencyExperiments: '{{LatencyExperiments}}',
                PacketLossExperiments: '{{PacketLossExperiments}}',
              },
              Script: faultInjectorScript,
            },
            outputs: [
              {
                Name: 'Result',
                Selector: '$.Payload',
                Type: 'String',
              },
            ],
            isEnd: true,
          },
        ],
        outputs: ['StartExperiment.Result'],
      },
    });

    // Create SSM document for inducing latency
    new ssm.CfnDocument(this, 'addLatency', {
      documentType: 'Automation',
      documentFormat: 'YAML',
      content: {
        schemaVersion: '0.3',
        assumeRole: role.roleArn,
        parameters: {
          LatencyExperiments: {
            type: 'StringList',
            minItems: 1,
            description: '(Required) The latency experiment templates to choose from',
            default: props.latencyExperiments.map((exp) => exp.ref),
          },
        },
        mainSteps: [
          {
            name: 'StartExperiment',
            action: 'aws:executeScript',
            inputs: {
              Runtime: 'python3.11',
              Handler: 'handler',
              InputPayload: {
                LatencyExperiments: '{{LatencyExperiments}}',
              },
              Script: latencyExperimentScript,
            },
            outputs: [
              {
                Name: 'Result',
                Selector: '$.Payload',
                Type: 'String',
              },
            ],
            isEnd: true,
          },
        ],
        outputs: ['StartExperiment.Result'],
      },
    });

    // Create SSM document for adding packet loss
    new ssm.CfnDocument(this, 'addPacketLoss', {
      documentType: 'Automation',
      documentFormat: 'YAML',
      content: {
        schemaVersion: '0.3',
        assumeRole: role.roleArn,
        parameters: {
          PacketLossExperiments: {
            type: 'StringList',
            minItems: 1,
            description: '(Required) The latency experiment templates to choose from',
            default: props.packetLossExperiments.map((exp) => exp.ref),
          },
        },
        mainSteps: [
          {
            name: 'StartExperiment',
            action: 'aws:executeScript',
            inputs: {
              Runtime: 'python3.11',
              Handler: 'handler',
              InputPayload: {
                PacketLossExperiments: '{{PacketLossExperiments}}',
              },
              Script: packetLossExperimentScript,
            },
            outputs: [
              {
                Name: 'Result',
                Selector: '$.Payload',
                Type: 'String',
              },
            ],
            isEnd: true,
          },
        ],
        outputs: ['StartExperiment.Result'],
      },
    });
  }
}
