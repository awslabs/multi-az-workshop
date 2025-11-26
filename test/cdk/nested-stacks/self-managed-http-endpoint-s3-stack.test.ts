import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SelfManagedHttpEndpointS3Stack } from '../../../src/cdk/lib/nested-stacks/self-managed-http-endpoint-s3-stack';
import { synthesizeStack, findResourcesByType } from '../../helpers/stack-helpers';

describe('SelfManagedHttpEndpointS3Stack', () => {
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
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      expect(() => synthesizeStack(s3Stack)).not.toThrow();
    });

    test('creates nested stack resource', () => {
      new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(parentStack);
      template.resourceCountIs('AWS::CloudFormation::Stack', 1);
    });
  });

  describe('S3 bucket creation', () => {
    test('creates S3 bucket', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      template.resourceCountIs('AWS::S3::Bucket', 1);
    });

    test('configures bucket with DESTROY removal policy', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      const buckets = findResourcesByType(template, 'AWS::S3::Bucket');
      expect(buckets.length).toBe(1);
      expect(buckets[0].DeletionPolicy).toBe('Delete');
    });

    test('configures bucket with bucket owner enforced ownership', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      template.hasResourceProperties('AWS::S3::Bucket', {
        OwnershipControls: {
          Rules: [
            {
              ObjectOwnership: 'BucketOwnerEnforced',
            },
          ],
        },
      });
    });

    test('exposes bucket as public property', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      expect(s3Stack.bucket).toBeDefined();
      expect(s3Stack.bucket.bucketName).toBeDefined();
    });

    test('exposes bucket URL as public property', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      expect(s3Stack.bucketUrl).toBeDefined();
      expect(typeof s3Stack.bucketUrl).toBe('string');
      expect(s3Stack.bucketUrl).toContain('https://');
    });

    test('exposes resource path as public property', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      expect(s3Stack.resourcePath).toBe('/');
    });
  });

  describe('bucket configuration', () => {
    test('configures public access block settings', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      template.hasResourceProperties('AWS::S3::Bucket', {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: false,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: false,
        },
      });
    });

    test('creates bucket policy for public read access', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      template.resourceCountIs('AWS::S3::BucketPolicy', 1);
    });

    test('bucket policy allows GetObject for tagged objects', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      template.hasResourceProperties('AWS::S3::BucketPolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 's3:GetObject',
              Effect: 'Allow',
              Principal: Match.objectLike({
                AWS: '*',
              }),
              Condition: {
                StringEquals: {
                  's3:ExistingObjectTag/public': 'true',
                },
              },
            }),
          ]),
        },
      });
    });

    test('bucket policy references bucket', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      const bucketPolicies = findResourcesByType(template, 'AWS::S3::BucketPolicy');
      expect(bucketPolicies.length).toBe(1);
      expect(bucketPolicies[0].Properties.Bucket).toBeDefined();
    });
  });

  describe('IAM role and policies', () => {
    test('creates IAM role for SSM runbook', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
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
        Path: '/az-evacuation/',
      });
    });

    test('creates managed policy for S3 operations', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      template.resourceCountIs('AWS::IAM::ManagedPolicy', 1);
      template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
        Path: '/az-evacuation/',
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                's3:PutObject',
                's3:PutObjectTagging',
                's3:DeleteObject',
              ]),
              Effect: 'Allow',
            }),
          ]),
        }),
      });
    });

    test('managed policy grants access to bucket objects', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      const managedPolicies = findResourcesByType(template, 'AWS::IAM::ManagedPolicy');
      expect(managedPolicies.length).toBe(1);
      const policy = managedPolicies[0];
      const statements = policy.Properties.PolicyDocument.Statement;
      expect(statements.length).toBeGreaterThan(0);
      const s3Statement = statements.find((s: any) =>
        Array.isArray(s.Action) && s.Action.includes('s3:PutObject'),
      );
      expect(s3Statement).toBeDefined();
      expect(s3Statement.Resource).toBeDefined();
    });

    test('role has managed policy attached', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      const roles = findResourcesByType(template, 'AWS::IAM::Role');
      expect(roles.length).toBe(1);
      expect(roles[0].Properties.ManagedPolicyArns).toBeDefined();
      expect(Array.isArray(roles[0].Properties.ManagedPolicyArns)).toBe(true);
    });
  });

  describe('SSM automation document', () => {
    test('creates SSM automation document', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      template.resourceCountIs('AWS::SSM::Document', 1);
    });

    test('configures document as Automation type', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      template.hasResourceProperties('AWS::SSM::Document', {
        DocumentType: 'Automation',
      });
    });

    test('configures document with JSON format', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      template.hasResourceProperties('AWS::SSM::Document', {
        DocumentFormat: 'JSON',
      });
    });

    test('configures document with schema version 0.3', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      expect(documents.length).toBe(1);
      expect(documents[0].Properties.Content.schemaVersion).toBe('0.3');
    });

    test('document references IAM role', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      expect(documents[0].Properties.Content.assumeRole).toBeDefined();
    });
  });

  describe('automation document parameters', () => {
    test('defines AZ parameter with allowed values', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const params = documents[0].Properties.Content.parameters;
      expect(params.AZ).toBeDefined();
      expect(params.AZ.type).toBe('String');
      expect(params.AZ.allowedValues).toEqual(availabilityZoneIds);
    });

    test('defines IsHealthy parameter with boolean values', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const params = documents[0].Properties.Content.parameters;
      expect(params.IsHealthy).toBeDefined();
      expect(params.IsHealthy.type).toBe('String');
      expect(params.IsHealthy.allowedValues).toEqual(['true', 'false']);
    });
  });

  describe('automation document steps', () => {
    test('has DecideAction branching step', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const mainSteps = documents[0].Properties.Content.mainSteps;
      const decideStep = mainSteps.find((s: any) => s.name === 'DecideAction');
      expect(decideStep).toBeDefined();
      expect(decideStep.action).toBe('aws:branch');
    });

    test('has EvacuateAZ step for unhealthy AZ', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const mainSteps = documents[0].Properties.Content.mainSteps;
      const evacuateStep = mainSteps.find((s: any) => s.name === 'EvacuateAZ');
      expect(evacuateStep).toBeDefined();
      expect(evacuateStep.action).toBe('aws:executeScript');
      expect(evacuateStep.isEnd).toBe(true);
    });

    test('has RecoverAZ step for healthy AZ', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const mainSteps = documents[0].Properties.Content.mainSteps;
      const recoverStep = mainSteps.find((s: any) => s.name === 'RecoverAZ');
      expect(recoverStep).toBeDefined();
      expect(recoverStep.action).toBe('aws:executeAwsApi');
      expect(recoverStep.isEnd).toBe(true);
    });

    test('EvacuateAZ step uses Python 3.8 runtime', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const mainSteps = documents[0].Properties.Content.mainSteps;
      const evacuateStep = mainSteps.find((s: any) => s.name === 'EvacuateAZ');
      expect(evacuateStep.inputs.Runtime).toBe('python3.8');
    });

    test('EvacuateAZ step has Python script', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const mainSteps = documents[0].Properties.Content.mainSteps;
      const evacuateStep = mainSteps.find((s: any) => s.name === 'EvacuateAZ');
      expect(evacuateStep.inputs.Script).toBeDefined();
    });

    test('EvacuateAZ step has input payload with AZ and Bucket', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const mainSteps = documents[0].Properties.Content.mainSteps;
      const evacuateStep = mainSteps.find((s: any) => s.name === 'EvacuateAZ');
      expect(evacuateStep.inputs.InputPayload).toBeDefined();
      expect(evacuateStep.inputs.InputPayload.AZ).toBeDefined();
      expect(evacuateStep.inputs.InputPayload.Bucket).toBeDefined();
    });

    test('RecoverAZ step uses S3 DeleteObject API', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const mainSteps = documents[0].Properties.Content.mainSteps;
      const recoverStep = mainSteps.find((s: any) => s.name === 'RecoverAZ');
      expect(recoverStep.inputs.Service).toBe('s3');
      expect(recoverStep.inputs.Api).toBe('DeleteObject');
    });

    test('RecoverAZ step references bucket and AZ key', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const mainSteps = documents[0].Properties.Content.mainSteps;
      const recoverStep = mainSteps.find((s: any) => s.name === 'RecoverAZ');
      expect(recoverStep.inputs.Bucket).toBeDefined();
      expect(recoverStep.inputs.Key).toBe('{{AZ}}');
    });
  });

  describe('stack parameters', () => {
    test('uses provided availability zone IDs', () => {
      const customAzIds = ['use1-az4', 'use1-az5'];
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds: customAzIds,
      });

      const template = Template.fromStack(s3Stack);
      const documents = findResourcesByType(template, 'AWS::SSM::Document');
      const params = documents[0].Properties.Content.parameters;
      expect(params.AZ.allowedValues).toEqual(customAzIds);
    });
  });

  describe('CloudFormation resources', () => {
    test('creates all required resource types', () => {
      const s3Stack = new SelfManagedHttpEndpointS3Stack(parentStack, 'S3Stack', {
        availabilityZoneIds,
      });

      const template = Template.fromStack(s3Stack);
      template.resourceCountIs('AWS::S3::Bucket', 1);
      template.resourceCountIs('AWS::S3::BucketPolicy', 1);
      template.resourceCountIs('AWS::IAM::Role', 1);
      template.resourceCountIs('AWS::IAM::ManagedPolicy', 1);
      template.resourceCountIs('AWS::SSM::Document', 1);
    });
  });
});
