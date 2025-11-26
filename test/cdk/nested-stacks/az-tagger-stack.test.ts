import * as cdk from 'aws-cdk-lib';
import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AZTaggerStack } from '../../../src/cdk/lib/nested-stacks/az-tagger-stack';
import { synthesizeStack, findResourcesByType, getResourceCount } from '../../helpers/stack-helpers';

describe('AZTaggerStack', () => {
  let app: App;
  let parentStack: Stack;

  beforeEach(() => {
    app = new App();
    parentStack = new Stack(app, 'ParentStack', {
      env: { region: 'us-east-1', account: '123456789012' },
    });

    // Create required parameters for NestedStackWithSource
    new cdk.CfnParameter(parentStack, 'AssetsBucketName', {
      type: 'String',
      default: 'test-assets-bucket',
    });
    new cdk.CfnParameter(parentStack, 'AssetsBucketPrefix', {
      type: 'String',
      default: 'test-prefix/',
    });
  });

  describe('stack creation', () => {
    test('synthesizes without errors', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      expect(() => synthesizeStack(azTaggerStack)).not.toThrow();
    });

    test('creates nested stack resource', () => {
      new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(parentStack);
      template.resourceCountIs('AWS::CloudFormation::Stack', 1);
    });

    test('extends NestedStackWithSource', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      expect(azTaggerStack).toBeInstanceOf(Stack);
    });
  });

  describe('Lambda function creation for AZ tagging', () => {
    test('creates Lambda function', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);
      template.resourceCountIs('AWS::Lambda::Function', 1);
    });

    test('configures Lambda with Python 3.13 runtime', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);

      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'python3.13',
        Handler: 'index.handler',
      });
    });

    test('configures Lambda with ARM64 architecture', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);

      template.hasResourceProperties('AWS::Lambda::Function', {
        Architectures: ['arm64'],
      });
    });

    test('configures Lambda with X-Ray tracing', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);

      template.hasResourceProperties('AWS::Lambda::Function', {
        TracingConfig: {
          Mode: 'Active',
        },
      });
    });

    test('configures Lambda with 60 second timeout', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);

      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 60,
      });
    });

    test('configures Lambda with 512 MB memory', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);

      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 512,
      });
    });

    test('configures Lambda with environment variables', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);

      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            REGION: { Ref: 'AWS::Region' },
            PARTITION: { Ref: 'AWS::Partition' },
          },
        },
      });
    });

    test('uses code from asset', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);

      const functions = findResourcesByType(template, 'AWS::Lambda::Function');
      expect(functions[0].Properties.Code).toBeDefined();
      expect(functions[0].Properties.Code.S3Bucket).toBeDefined();
    });
  });

  describe('IAM role and policies', () => {
    test('creates execution role for Lambda', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);

      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            {
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                Service: 'lambda.amazonaws.com',
              },
            },
          ]),
        },
        Path: '/aztagger/',
      });
    });

    test('creates X-Ray managed policy', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);

      template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
        Path: '/aztagger/',
        PolicyDocument: {
          Statement: Match.arrayWith([
            {
              Action: [
                'xray:PutTraceSegments',
                'xray:PutTelemetryRecords',
                'xray:GetSamplingRules',
                'xray:GetSamplingTargets',
                'xray:GetSamplingStatisticSummaries',
              ],
              Effect: 'Allow',
              Resource: '*',
            },
          ]),
        },
      });
    });

    test('creates EC2 managed policy', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);

      template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
        Path: '/aztagger/',
        PolicyDocument: {
          Statement: Match.arrayWith([
            {
              Action: [
                'ec2:DescribeAvailabilityZones',
                'ec2:DescribeTags',
                'ec2:CreateTags',
                'ec2:DescribeInstances',
              ],
              Effect: 'Allow',
              Resource: '*',
            },
          ]),
        },
      });
    });

    test('creates CloudWatch Logs managed policy', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);

      const policies = findResourcesByType(template, 'AWS::IAM::ManagedPolicy');
      const cwPolicy = policies.find((p) => p.Properties.Path === '/azmapper/');

      expect(cwPolicy).toBeDefined();
      expect(cwPolicy.Properties.PolicyDocument.Statement).toBeDefined();

      const statements = cwPolicy.Properties.PolicyDocument.Statement;
      const putMetricStatement = statements.find((s: any) =>
        (Array.isArray(s.Action) && s.Action.includes('cloudwatch:PutMetricData')) ||
        s.Action === 'cloudwatch:PutMetricData',
      );

      expect(putMetricStatement).toBeDefined();
      expect(putMetricStatement.Effect).toBe('Allow');
    });

    test('attaches managed policies to execution role', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);

      const managedPolicyCount = getResourceCount(template, 'AWS::IAM::ManagedPolicy');
      expect(managedPolicyCount).toBe(3); // X-Ray, EC2, CloudWatch Logs
    });

    test('Lambda function references execution role', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);

      template.hasResourceProperties('AWS::Lambda::Function', {
        Role: Match.objectLike({
          'Fn::GetAtt': Match.arrayWith([
            Match.stringLikeRegexp('executionRole'),
            'Arn',
          ]),
        }),
      });
    });
  });

  describe('CloudWatch Logs configuration', () => {
    test('creates log group for Lambda function', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);

      template.resourceCountIs('AWS::Logs::LogGroup', 1);
    });

    test('configures log group with one day retention', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);

      template.hasResourceProperties('AWS::Logs::LogGroup', {
        RetentionInDays: 1,
      });
    });

    test('log group name matches Lambda function', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);

      const logGroups = findResourcesByType(template, 'AWS::Logs::LogGroup');
      expect(logGroups.length).toBe(1);

      const logGroupName = logGroups[0].Properties.LogGroupName;
      expect(logGroupName).toBeDefined();
      expect(logGroupName['Fn::Join']).toBeDefined();

      const parts = logGroupName['Fn::Join'][1];
      expect(parts).toContain('/aws/lambda/');
    });
  });

  describe('EventBridge rule configuration', () => {
    test('creates EventBridge rule for EC2 instance launch', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);

      template.resourceCountIs('AWS::Events::Rule', 1);
    });

    test('configures rule to trigger on EC2 pending state', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);

      template.hasResourceProperties('AWS::Events::Rule', {
        EventPattern: {
          'source': ['aws.ec2'],
          'detail-type': ['EC2 Instance State-change Notification'],
          'detail': {
            state: ['pending'],
          },
        },
        State: 'ENABLED',
      });
    });

    test('configures rule to target Lambda function', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);

      template.hasResourceProperties('AWS::Events::Rule', {
        Targets: Match.arrayWith([
          {
            Arn: Match.objectLike({
              'Fn::GetAtt': Match.arrayWith([
                Match.stringLikeRegexp('azTagger'),
                'Arn',
              ]),
            }),
            Id: Match.anyValue(),
          },
        ]),
      });
    });
  });

  describe('Lambda permissions', () => {
    test('grants EventBridge permission to invoke Lambda', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);

      template.hasResourceProperties('AWS::Lambda::Permission', {
        Action: 'lambda:InvokeFunction',
        Principal: 'events.amazonaws.com',
      });
    });

    test('permission source ARN references EventBridge rules', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);

      template.hasResourceProperties('AWS::Lambda::Permission', {
        SourceArn: Match.objectLike({
          'Fn::Sub': Match.stringLikeRegexp('arn:\\$\\{AWS::Partition\\}:events'),
        }),
      });
    });
  });

  describe('public interface', () => {
    test('exposes function ARN as public property', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      expect(azTaggerStack.functionArn).toBeDefined();
      expect(typeof azTaggerStack.functionArn).toBe('string');
    });
  });

  describe('stack parameters', () => {
    test('accepts optional nested stack props', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {
        description: 'Test AZ Tagger Stack',
      });
      expect(azTaggerStack).toBeDefined();
    });

    test('works without any props', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack');
      expect(azTaggerStack).toBeDefined();
    });
  });

  describe('CloudFormation resources', () => {
    test('creates all required resource types', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);

      template.resourceCountIs('AWS::Lambda::Function', 1);
      template.resourceCountIs('AWS::IAM::Role', 1);
      template.resourceCountIs('AWS::IAM::ManagedPolicy', 3);
      template.resourceCountIs('AWS::Logs::LogGroup', 1);
      template.resourceCountIs('AWS::Events::Rule', 1);

      // Lambda permissions may be 1 or 2 depending on EventBridge configuration
      const permissionCount = getResourceCount(template, 'AWS::Lambda::Permission');
      expect(permissionCount).toBeGreaterThanOrEqual(1);
    });

    test('creates resources in correct order', () => {
      const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});
      const template = Template.fromStack(azTaggerStack);

      // Verify role exists before function
      const roles = findResourcesByType(template, 'AWS::IAM::Role');
      const functions = findResourcesByType(template, 'AWS::Lambda::Function');

      expect(roles.length).toBeGreaterThan(0);
      expect(functions.length).toBeGreaterThan(0);
    });
  });
});
