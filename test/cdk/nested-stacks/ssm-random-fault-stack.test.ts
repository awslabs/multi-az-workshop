import * as cdk from 'aws-cdk-lib';
import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as fis from 'aws-cdk-lib/aws-fis';
import { SSMRandomFaultStack } from '../../../src/cdk/lib/nested-stacks/ssm-random-fault-stack';
import { synthesizeStack, findResourcesByType } from '../../helpers/stack-helpers';

describe('SSMRandomFaultStack', () => {
  let app: App;
  let parentStack: Stack;
  let latencyExperiments: fis.CfnExperimentTemplate[];
  let packetLossExperiments: fis.CfnExperimentTemplate[];

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

    // Create mock FIS experiment templates
    latencyExperiments = [];
    packetLossExperiments = [];

    for (let i = 0; i < 3; i++) {
      const latencyExp = new fis.CfnExperimentTemplate(parentStack, `LatencyExp${i}`, {
        roleArn: 'arn:aws:iam::123456789012:role/FISRole',
        description: 'Latency experiment',
        actions: {
          addLatency: {
            actionId: 'aws:ssm:send-command',
          },
        },
        targets: {},
        stopConditions: [{ source: 'none' }],
      });
      latencyExperiments.push(latencyExp);

      const packetLossExp = new fis.CfnExperimentTemplate(parentStack, `PacketLossExp${i}`, {
        roleArn: 'arn:aws:iam::123456789012:role/FISRole',
        description: 'Packet loss experiment',
        actions: {
          packetLoss: {
            actionId: 'aws:ssm:send-command',
          },
        },
        targets: {},
        stopConditions: [{ source: 'none' }],
      });
      packetLossExperiments.push(packetLossExp);
    }
  });

  describe('stack creation', () => {
    test('synthesizes without errors', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      expect(() => synthesizeStack(ssmStack)).not.toThrow();
    });

    test('creates nested stack resource', () => {
      new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(parentStack);
      template.resourceCountIs('AWS::CloudFormation::Stack', 1);
    });
  });

  describe('SSM document creation', () => {
    test('creates three SSM automation documents', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      template.resourceCountIs('AWS::SSM::Document', 3);
    });

    test('creates random fault selection document', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const randomFaultDoc = documents.find((doc) =>
        doc.Properties.Content?.parameters?.LatencyExperiments &&
        doc.Properties.Content?.parameters?.PacketLossExperiments,
      );
      expect(randomFaultDoc).toBeDefined();
    });

    test('creates add latency document', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const latencyDoc = documents.find((doc) =>
        doc.Properties.Content?.parameters?.LatencyExperiments &&
        !doc.Properties.Content?.parameters?.PacketLossExperiments,
      );
      expect(latencyDoc).toBeDefined();
    });

    test('creates add packet loss document', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const packetLossDoc = documents.find((doc) =>
        doc.Properties.Content?.parameters?.PacketLossExperiments &&
        !doc.Properties.Content?.parameters?.LatencyExperiments,
      );
      expect(packetLossDoc).toBeDefined();
    });
  });

  describe('automation document configuration', () => {
    test('configures documents as Automation type', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      documents.forEach((doc) => {
        expect(doc.Properties.DocumentType).toBe('Automation');
      });
    });

    test('configures documents with YAML format', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      documents.forEach((doc) => {
        expect(doc.Properties.DocumentFormat).toBe('YAML');
      });
    });

    test('configures documents with schema version 0.3', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      documents.forEach((doc) => {
        expect(doc.Properties.Content.schemaVersion).toBe('0.3');
      });
    });

    test('configures documents with Python 3.11 runtime', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      documents.forEach((doc) => {
        const mainSteps = doc.Properties.Content.mainSteps;
        expect(mainSteps).toBeDefined();
        expect(Array.isArray(mainSteps)).toBe(true);
        expect(mainSteps[0].inputs.Runtime).toBe('python3.11');
      });
    });

    test('configures documents with executeScript action', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      documents.forEach((doc) => {
        const mainSteps = doc.Properties.Content.mainSteps;
        expect(mainSteps[0].action).toBe('aws:executeScript');
      });
    });
  });

  describe('fault injection parameters', () => {
    test('random fault document has both experiment parameters', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const randomFaultDoc = documents.find((doc) =>
        doc.Properties.Content?.parameters?.LatencyExperiments &&
        doc.Properties.Content?.parameters?.PacketLossExperiments,
      );
      expect(randomFaultDoc).toBeDefined();
      expect(randomFaultDoc.Properties.Content.parameters.LatencyExperiments.type).toBe('StringList');
      expect(randomFaultDoc.Properties.Content.parameters.PacketLossExperiments.type).toBe('StringList');
    });

    test('latency document has latency experiment parameter', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const latencyDoc = documents.find((doc) =>
        doc.Properties.Content?.parameters?.LatencyExperiments &&
        !doc.Properties.Content?.parameters?.PacketLossExperiments,
      );
      expect(latencyDoc).toBeDefined();
      expect(latencyDoc.Properties.Content.parameters.LatencyExperiments.type).toBe('StringList');
      expect(latencyDoc.Properties.Content.parameters.LatencyExperiments.minItems).toBe(1);
    });

    test('packet loss document has packet loss experiment parameter', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const packetLossDoc = documents.find((doc) =>
        doc.Properties.Content?.parameters?.PacketLossExperiments &&
        !doc.Properties.Content?.parameters?.LatencyExperiments,
      );
      expect(packetLossDoc).toBeDefined();
      expect(packetLossDoc.Properties.Content.parameters.PacketLossExperiments.type).toBe('StringList');
      expect(packetLossDoc.Properties.Content.parameters.PacketLossExperiments.minItems).toBe(1);
    });

    test('documents have default values for experiment parameters', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      documents.forEach((doc) => {
        const params = doc.Properties.Content.parameters;
        if (params.LatencyExperiments) {
          expect(params.LatencyExperiments.default).toBeDefined();
          expect(Array.isArray(params.LatencyExperiments.default)).toBe(true);
        }
        if (params.PacketLossExperiments) {
          expect(params.PacketLossExperiments.default).toBeDefined();
          expect(Array.isArray(params.PacketLossExperiments.default)).toBe(true);
        }
      });
    });
  });

  describe('IAM role and policies', () => {
    test('creates IAM role for SSM automation', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      template.resourceCountIs('AWS::IAM::Role', 1);
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: Match.objectLike({
                Service: 'ssm.amazonaws.com',
              }),
            }),
          ]),
        }),
      });
    });

    test('creates managed policy for FIS experiment execution', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      template.resourceCountIs('AWS::IAM::ManagedPolicy', 1);
      const managedPolicies = findResourcesByType(template, 'AWS::IAM::ManagedPolicy');
      expect(managedPolicies.length).toBe(1);
      const policy = managedPolicies[0];
      const statements = policy.Properties.PolicyDocument.Statement;
      const fisStatement = statements.find((s: any) =>
        (Array.isArray(s.Action) && s.Action.includes('fis:StartExperiment')) ||
        s.Action === 'fis:StartExperiment',
      );
      expect(fisStatement).toBeDefined();
      expect(fisStatement.Effect).toBe('Allow');
    });

    test('grants permission to start all latency experiments', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      const managedPolicies = findResourcesByType(template, 'AWS::IAM::ManagedPolicy');
      expect(managedPolicies.length).toBe(1);
      const policy = managedPolicies[0];
      const statements = policy.Properties.PolicyDocument.Statement;
      const fisStatement = statements.find((s: any) => s.Action.includes('fis:StartExperiment'));
      expect(fisStatement).toBeDefined();
      expect(fisStatement.Resource).toBeDefined();
      expect(Array.isArray(fisStatement.Resource)).toBe(true);
      expect(fisStatement.Resource.length).toBeGreaterThan(0);
    });

    test('grants permission to start all packet loss experiments', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      const managedPolicies = findResourcesByType(template, 'AWS::IAM::ManagedPolicy');
      const policy = managedPolicies[0];
      const statements = policy.Properties.PolicyDocument.Statement;
      const fisStatement = statements.find((s: any) => s.Action.includes('fis:StartExperiment'));
      expect(fisStatement.Resource.length).toBeGreaterThan(latencyExperiments.length);
    });

    test('grants CodeDeploy permissions', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                'codedeploy:CreateDeployment',
                'codedeploy:GetApplicationRevision',
                'codedeploy:GetDeploymentConfig',
                'codedeploy:RegisterApplicationRevision',
              ]),
              Effect: 'Allow',
            }),
          ]),
        }),
      });
    });

    test('documents reference IAM role', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      documents.forEach((doc) => {
        expect(doc.Properties.Content.assumeRole).toBeDefined();
      });
    });
  });

  describe('document outputs', () => {
    test('documents define outputs', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      documents.forEach((doc) => {
        expect(doc.Properties.Content.outputs).toBeDefined();
        expect(Array.isArray(doc.Properties.Content.outputs)).toBe(true);
        expect(doc.Properties.Content.outputs.length).toBeGreaterThan(0);
      });
    });

    test('documents output StartExperiment result', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      documents.forEach((doc) => {
        expect(doc.Properties.Content.outputs).toContain('StartExperiment.Result');
      });
    });
  });

  describe('main steps configuration', () => {
    test('documents have StartExperiment step', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      documents.forEach((doc) => {
        const mainSteps = doc.Properties.Content.mainSteps;
        expect(mainSteps).toBeDefined();
        expect(mainSteps[0].name).toBe('StartExperiment');
      });
    });

    test('StartExperiment step is marked as end', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      documents.forEach((doc) => {
        const mainSteps = doc.Properties.Content.mainSteps;
        expect(mainSteps[0].isEnd).toBe(true);
      });
    });

    test('StartExperiment step has handler function', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      documents.forEach((doc) => {
        const mainSteps = doc.Properties.Content.mainSteps;
        expect(mainSteps[0].inputs.Handler).toBe('handler');
      });
    });

    test('StartExperiment step has Python script', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      documents.forEach((doc) => {
        const mainSteps = doc.Properties.Content.mainSteps;
        expect(mainSteps[0].inputs.Script).toBeDefined();
        expect(typeof mainSteps[0].inputs.Script).toBe('string');
        expect(mainSteps[0].inputs.Script.length).toBeGreaterThan(0);
      });
    });

    test('StartExperiment step has input payload', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      documents.forEach((doc) => {
        const mainSteps = doc.Properties.Content.mainSteps;
        expect(mainSteps[0].inputs.InputPayload).toBeDefined();
      });
    });

    test('StartExperiment step has output configuration', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      documents.forEach((doc) => {
        const mainSteps = doc.Properties.Content.mainSteps;
        expect(mainSteps[0].outputs).toBeDefined();
        expect(Array.isArray(mainSteps[0].outputs)).toBe(true);
        expect(mainSteps[0].outputs[0].Name).toBe('Result');
        expect(mainSteps[0].outputs[0].Selector).toBe('$.Payload');
        expect(mainSteps[0].outputs[0].Type).toBe('String');
      });
    });
  });

  describe('CloudFormation resources', () => {
    test('creates all required resource types', () => {
      const ssmStack = new SSMRandomFaultStack(parentStack, 'SSMStack', {
        latencyExperiments,
        packetLossExperiments,
      });

      const template = Template.fromStack(ssmStack);
      template.resourceCountIs('AWS::SSM::Document', 3);
      template.resourceCountIs('AWS::IAM::Role', 1);
      template.resourceCountIs('AWS::IAM::ManagedPolicy', 1);
    });
  });
});
