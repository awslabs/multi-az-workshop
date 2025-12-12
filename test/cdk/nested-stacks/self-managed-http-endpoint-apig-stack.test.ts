import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { SelfManagedHttpEndpointApigStack } from '../../../src/cdk/lib/nested-stacks/self-managed-http-endpoint-apig-stack';
import { synthesizeStack, findResourcesByType } from '../../helpers/stack-helpers';

describe('SelfManagedHttpEndpointApigStack', () => {
  let app: App;
  let parentStack: Stack;
  const availabilityZoneIds = ['use1-az1', 'use1-az2', 'use1-az3'];

  beforeEach(() => {
    app = new App();
    parentStack = new Stack(app, 'ParentStack', {
      env: { region: 'us-east-1', account: '123456789012' },
    });
  });

  describe('stack creation', () => {
    test('synthesizes without errors', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      expect(() => synthesizeStack(apigStack)).not.toThrow();
    });

    test('creates nested stack resource', () => {
      new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(parentStack);
      template.resourceCountIs('AWS::CloudFormation::Stack', 1);
    });
  });

  describe('DynamoDB table creation', () => {
    test('creates DynamoDB table', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      template.resourceCountIs('AWS::DynamoDB::Table', 1);
    });

    test('configures table with PAY_PER_REQUEST billing', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        BillingMode: 'PAY_PER_REQUEST',
      });
    });

    test('configures table with AWS managed encryption', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        SSESpecification: {
          SSEEnabled: true,
        },
      });
    });

    test('configures table with AZ-ID partition key', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        KeySchema: [
          {
            AttributeName: 'AZ-ID',
            KeyType: 'HASH',
          },
        ],
        AttributeDefinitions: [
          {
            AttributeName: 'AZ-ID',
            AttributeType: 'S',
          },
        ],
      });
    });

    test('sets removal policy to DESTROY', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const tables = findResourcesByType(template, 'AWS::DynamoDB::Table');
      expect(tables.length).toBe(1);
      expect(tables[0].DeletionPolicy).toBe('Delete');
    });
  });

  describe('API Gateway creation', () => {
    test('creates REST API', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    });

    test('configures API with REGIONAL endpoint', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      template.hasResourceProperties('AWS::ApiGateway::RestApi', {
        EndpointConfiguration: {
          Types: ['REGIONAL'],
        },
      });
    });

    test('configures API with description', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const restApis = findResourcesByType(template, 'AWS::ApiGateway::RestApi');
      expect(restApis.length).toBe(1);
      expect(restApis[0].Properties.Description).toBeDefined();
      expect(restApis[0].Properties.Description).toContain('AZ ID');
    });

    test('exposes API as public property', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      expect(apigStack.api).toBeDefined();
      expect(apigStack.api.restApiId).toBeDefined();
    });

    test('exposes resource path as public property', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      expect(apigStack.resourcePath).toBeDefined();
      expect(typeof apigStack.resourcePath).toBe('string');
    });
  });

  describe('API configuration', () => {
    test('creates deployment', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      template.resourceCountIs('AWS::ApiGateway::Deployment', 1);
    });

    test('creates stage', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      template.resourceCountIs('AWS::ApiGateway::Stage', 1);
    });

    test('stage has failOpen variable', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
        failOpen: true,
      });

      const template = Template.fromStack(apigStack);
      const stages = findResourcesByType(template, 'AWS::ApiGateway::Stage');
      expect(stages.length).toBe(1);
      expect(stages[0].Properties.Variables).toBeDefined();
      expect(stages[0].Properties.Variables.failOpen).toBe('true');
    });

    test('uses failOpen=true by default', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const stages = findResourcesByType(template, 'AWS::ApiGateway::Stage');
      expect(stages[0].Properties.Variables.failOpen).toBe('true');
    });

    test('uses failOpen=false when specified', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
        failOpen: false,
      });

      const template = Template.fromStack(apigStack);
      const stages = findResourcesByType(template, 'AWS::ApiGateway::Stage');
      expect(stages[0].Properties.Variables.failOpen).toBe('false');
    });

    test('creates /status resource', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const resources = findResourcesByType(template, 'AWS::ApiGateway::Resource');
      const statusResource = resources.find((r) => r.Properties.PathPart === 'status');
      expect(statusResource).toBeDefined();
    });

    test('creates /{az-id} resource under /status', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const resources = findResourcesByType(template, 'AWS::ApiGateway::Resource');
      const azIdResource = resources.find((r) => r.Properties.PathPart === '{az-id}');
      expect(azIdResource).toBeDefined();
    });

    test('creates GET method on /{az-id} resource', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'GET',
      });
    });
  });

  describe('DynamoDB integration', () => {
    test('method integrates with DynamoDB GetItem', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const methods = findResourcesByType(template, 'AWS::ApiGateway::Method');
      const getMethod = methods.find((m) => m.Properties.HttpMethod === 'GET');
      expect(getMethod).toBeDefined();
      expect(getMethod.Properties.Integration).toBeDefined();
      expect(getMethod.Properties.Integration.Type).toBe('AWS');
      expect(getMethod.Properties.Integration.IntegrationHttpMethod).toBe('POST');
    });

    test('integration uses request template to map az-id parameter', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const methods = findResourcesByType(template, 'AWS::ApiGateway::Method');
      const getMethod = methods.find((m) => m.Properties.HttpMethod === 'GET');
      expect(getMethod.Properties.Integration.RequestTemplates).toBeDefined();
      expect(getMethod.Properties.Integration.RequestTemplates['application/json']).toBeDefined();
    });

    test('integration uses response template with VTL logic', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const methods = findResourcesByType(template, 'AWS::ApiGateway::Method');
      const getMethod = methods.find((m) => m.Properties.HttpMethod === 'GET');
      expect(getMethod.Properties.Integration.IntegrationResponses).toBeDefined();
      expect(getMethod.Properties.Integration.IntegrationResponses.length).toBeGreaterThan(0);
      const responseTemplate = getMethod.Properties.Integration.IntegrationResponses[0].ResponseTemplates;
      expect(responseTemplate).toBeDefined();
      expect(responseTemplate['application/json']).toBeDefined();
    });

    test('integration has 200 response', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const methods = findResourcesByType(template, 'AWS::ApiGateway::Method');
      const getMethod = methods.find((m) => m.Properties.HttpMethod === 'GET');
      expect(getMethod.Properties.MethodResponses).toBeDefined();
      const response200 = getMethod.Properties.MethodResponses.find((r: any) => r.StatusCode === '200');
      expect(response200).toBeDefined();
    });
  });

  describe('IAM roles and policies', () => {
    test('creates execution role for API Gateway', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const roles = findResourcesByType(template, 'AWS::IAM::Role');
      const apiGatewayRole = roles.find((r) => r.Properties.Path === '/az-evacuation/');
      expect(apiGatewayRole).toBeDefined();
      expect(apiGatewayRole.Properties.AssumeRolePolicyDocument.Statement[0].Principal.Service).toBe('apigateway.amazonaws.com');
    });

    test('creates managed policy for DynamoDB access', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const managedPolicies = findResourcesByType(template, 'AWS::IAM::ManagedPolicy');
      const ddbPolicy = managedPolicies.find((p) => p.Properties.Path === '/az-evacuation/');
      expect(ddbPolicy).toBeDefined();
      const statements = ddbPolicy.Properties.PolicyDocument.Statement;
      const ddbStatement = statements.find((s: any) =>
        Array.isArray(s.Action) && s.Action.includes('dynamodb:GetItem'),
      );
      expect(ddbStatement).toBeDefined();
    });

    test('grants GetItem, UpdateItem, and PutItem permissions', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const managedPolicies = findResourcesByType(template, 'AWS::IAM::ManagedPolicy');
      const ddbPolicy = managedPolicies.find((p) => p.Properties.Path === '/az-evacuation/');
      const statements = ddbPolicy.Properties.PolicyDocument.Statement;
      const ddbStatement = statements.find((s: any) =>
        Array.isArray(s.Action) && s.Action.includes('dynamodb:GetItem'),
      );
      expect(ddbStatement.Action).toContain('dynamodb:GetItem');
      expect(ddbStatement.Action).toContain('dynamodb:UpdateItem');
      expect(ddbStatement.Action).toContain('dynamodb:PutItem');
    });

    test('creates runbook role for SSM automation', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const roles = findResourcesByType(template, 'AWS::IAM::Role');
      const runbookRole = roles.find((r) => r.Properties.Path === '/az-circuit-breaker/');
      expect(runbookRole).toBeDefined();
      expect(runbookRole.Properties.AssumeRolePolicyDocument.Statement[0].Principal.Service).toBe('ssm.amazonaws.com');
    });

    test('creates runbook managed policy for DynamoDB updates', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const managedPolicies = findResourcesByType(template, 'AWS::IAM::ManagedPolicy');
      const runbookPolicy = managedPolicies.find((p) => p.Properties.Path === '/az-circuit-breaker/');
      expect(runbookPolicy).toBeDefined();
      const statements = runbookPolicy.Properties.PolicyDocument.Statement;
      const ddbStatement = statements.find((s: any) =>
        Array.isArray(s.Action) && s.Action.includes('dynamodb:UpdateItem'),
      );
      expect(ddbStatement).toBeDefined();
      expect(ddbStatement.Action).toContain('dynamodb:UpdateItem');
      expect(ddbStatement.Action).toContain('dynamodb:PutItem');
    });
  });

  describe('SSM automation document', () => {
    test('creates SSM automation document', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      template.resourceCountIs('AWS::SSM::Document', 1);
    });

    test('configures document as Automation type', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      template.hasResourceProperties('AWS::SSM::Document', {
        DocumentType: 'Automation',
      });
    });

    test('configures document with JSON format', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      template.hasResourceProperties('AWS::SSM::Document', {
        DocumentFormat: 'JSON',
      });
    });

    test('configures document with schema version 0.3', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      expect(documents.length).toBe(1);
      expect(documents[0].Properties.Content.schemaVersion).toBe('0.3');
    });

    test('document references runbook IAM role', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      expect(documents[0].Properties.Content.assumeRole).toBeDefined();
    });

    test('exposes automation document as public property', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      expect(apigStack.automationDocument).toBeDefined();
    });
  });

  describe('automation document parameters', () => {
    test('defines AZ parameter with allowed values', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const params = documents[0].Properties.Content.parameters;
      expect(params.AZ).toBeDefined();
      expect(params.AZ.type).toBe('String');
      expect(params.AZ.allowedValues).toEqual(availabilityZoneIds);
    });

    test('defines IsHealthy parameter with boolean type', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const params = documents[0].Properties.Content.parameters;
      expect(params.IsHealthy).toBeDefined();
      expect(params.IsHealthy.type).toBe('Boolean');
      expect(params.IsHealthy.allowedValues).toEqual(['true', 'false']);
    });
  });

  describe('automation document steps', () => {
    test('has UpdateAZ step', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const mainSteps = documents[0].Properties.Content.mainSteps;
      const updateStep = mainSteps.find((s: any) => s.name === 'UpdateAZ');
      expect(updateStep).toBeDefined();
    });

    test('UpdateAZ step uses executeAwsApi action', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const mainSteps = documents[0].Properties.Content.mainSteps;
      const updateStep = mainSteps.find((s: any) => s.name === 'UpdateAZ');
      expect(updateStep.action).toBe('aws:executeAwsApi');
      expect(updateStep.isEnd).toBe(true);
    });

    test('UpdateAZ step calls DynamoDB UpdateItem', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const mainSteps = documents[0].Properties.Content.mainSteps;
      const updateStep = mainSteps.find((s: any) => s.name === 'UpdateAZ');
      expect(updateStep.inputs.Service).toBe('dynamodb');
      expect(updateStep.inputs.Api).toBe('UpdateItem');
    });

    test('UpdateAZ step references table name', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const mainSteps = documents[0].Properties.Content.mainSteps;
      const updateStep = mainSteps.find((s: any) => s.name === 'UpdateAZ');
      expect(updateStep.inputs.TableName).toBeDefined();
    });

    test('UpdateAZ step uses AZ parameter as key', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const mainSteps = documents[0].Properties.Content.mainSteps;
      const updateStep = mainSteps.find((s: any) => s.name === 'UpdateAZ');
      expect(updateStep.inputs.Key).toBeDefined();
      expect(updateStep.inputs.Key['AZ-ID']).toBeDefined();
      expect(updateStep.inputs.Key['AZ-ID'].S).toBe('{{AZ}}');
    });

    test('UpdateAZ step sets Healthy attribute', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const mainSteps = documents[0].Properties.Content.mainSteps;
      const updateStep = mainSteps.find((s: any) => s.name === 'UpdateAZ');
      expect(updateStep.inputs.ExpressionAttributeValues).toBeDefined();
      expect(updateStep.inputs.ExpressionAttributeValues[':h']).toBeDefined();
      expect(updateStep.inputs.ExpressionAttributeValues[':h'].BOOL).toBe('{{IsHealthy}}');
    });

    test('UpdateAZ step sets LastUpdate and ExecutionId attributes', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const mainSteps = documents[0].Properties.Content.mainSteps;
      const updateStep = mainSteps.find((s: any) => s.name === 'UpdateAZ');
      expect(updateStep.inputs.ExpressionAttributeValues[':dt']).toBeDefined();
      expect(updateStep.inputs.ExpressionAttributeValues[':dt'].S).toBe('{{global:DATE_TIME}}');
      expect(updateStep.inputs.ExpressionAttributeValues[':ex']).toBeDefined();
      expect(updateStep.inputs.ExpressionAttributeValues[':ex'].S).toBe('{{automation:EXECUTION_ID}}');
    });

    test('UpdateAZ step uses UpdateExpression', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const mainSteps = documents[0].Properties.Content.mainSteps;
      const updateStep = mainSteps.find((s: any) => s.name === 'UpdateAZ');
      expect(updateStep.inputs.UpdateExpression).toBeDefined();
      expect(updateStep.inputs.UpdateExpression).toContain('SET Healthy = :h');
    });
  });

  describe('stack parameters', () => {
    test('uses provided availability zone IDs', () => {
      const customAzIds = ['use1-az4', 'use1-az5'];
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds: customAzIds,
      });

      const template = Template.fromStack(apigStack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const params = documents[0].Properties.Content.parameters;
      expect(params.AZ.allowedValues).toEqual(customAzIds);
    });
  });

  describe('CloudFormation resources', () => {
    test('creates all required resource types', () => {
      const apigStack = new SelfManagedHttpEndpointApigStack(parentStack, 'ApigStack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(apigStack);
      template.resourceCountIs('AWS::DynamoDB::Table', 1);
      template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
      template.resourceCountIs('AWS::ApiGateway::Deployment', 1);
      template.resourceCountIs('AWS::ApiGateway::Stage', 1);
      template.resourceCountIs('AWS::SSM::Document', 1);

      // At least 2 IAM roles (API Gateway execution role and runbook role)
      const roleCount = findResourcesByType(template, 'AWS::IAM::Role').length;
      expect(roleCount).toBeGreaterThanOrEqual(2);

      // At least 2 managed policies (DynamoDB access for API Gateway and runbook)
      const policyCount = findResourcesByType(template, 'AWS::IAM::ManagedPolicy').length;
      expect(policyCount).toBeGreaterThanOrEqual(2);
    });
  });
});
