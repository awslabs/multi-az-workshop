import * as cdk from 'aws-cdk-lib';
import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';

// Mock the ApplicationStack module to avoid file system dependencies
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('../../../src/cdk/lib/nested-stacks/application-stack', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const actual = jest.requireActual('../../../src/cdk/lib/nested-stacks/application-stack');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs');
  const originalReadFileSync = fs.readFileSync;

  // Override readFileSync only for this module
  fs.readFileSync = jest.fn((path: any, options?: any) => {
    if (path.toString().includes('uploader-src/index.py')) {
      return 'def handler(event, context):\n    return {"statusCode": 200}';
    }
    return originalReadFileSync(path, options);
  });

  return actual;
});

import { ApplicationStack } from '../../../src/cdk/lib/nested-stacks/application-stack';
import { createMockUploaderFunction } from '../../helpers';
import { synthesizeStack, findResourcesByType } from '../../helpers/stack-helpers';

describe('ApplicationStack', () => {
  let app: App;
  let parentStack: Stack;
  let uploaderFunction: any;

  beforeEach(() => {
    app = new App();
    parentStack = new Stack(app, 'ParentStack', {
      env: { region: 'us-east-1', account: '123456789012' },
    });

    // Add required parameters for NestedStackWithSource
    new cdk.CfnParameter(parentStack, 'AssetsBucketName', {
      type: 'String',
      default: 'test-bucket',
    });
    new cdk.CfnParameter(parentStack, 'AssetsBucketPrefix', {
      type: 'String',
      default: 'test-prefix/',
    });

    // Create shared uploader function for all tests
    uploaderFunction = createMockUploaderFunction(parentStack);
  });

  describe('stack creation', () => {
    test('synthesizes without errors', () => {
      const appStack = new ApplicationStack(parentStack, 'ApplicationStack', {
        containerImageObjectKey: 'app.tar.gz',
        containerImageWithFaultObjectKey: 'app-fault.tar.gz',
        uploaderFunction,
      });

      expect(() => synthesizeStack(appStack)).not.toThrow();
    });

    test('creates nested stack resource', () => {
      new ApplicationStack(parentStack, 'ApplicationStack', {
        containerImageObjectKey: 'app.tar.gz',
        containerImageWithFaultObjectKey: 'app-fault.tar.gz',
        uploaderFunction,
      });

      const template = Template.fromStack(parentStack);
      template.resourceCountIs('AWS::CloudFormation::Stack', 1);
    });
  });

  describe('container repository creation', () => {
    test('creates ECR repository for application', () => {
      const appStack = new ApplicationStack(parentStack, 'ApplicationStack', {
        containerImageObjectKey: 'app.tar.gz',
        containerImageWithFaultObjectKey: 'app-fault.tar.gz',
        uploaderFunction,
      });

      const template = Template.fromStack(appStack);
      const repositories = findResourcesByType(template, 'AWS::ECR::Repository');
      expect(repositories.length).toBeGreaterThan(0);
    });

    test('configures repository with removal policy', () => {
      const appStack = new ApplicationStack(parentStack, 'ApplicationStack', {
        containerImageObjectKey: 'app.tar.gz',
        containerImageWithFaultObjectKey: 'app-fault.tar.gz',
        uploaderFunction,
      });

      const template = Template.fromStack(appStack);
      const repositories = findResourcesByType(template, 'AWS::ECR::Repository');
      expect(repositories.length).toBeGreaterThan(0);
      expect(repositories[0].DeletionPolicy).toBe('Delete');
    });

    test('creates repository for CloudWatch agent', () => {
      const appStack = new ApplicationStack(parentStack, 'ApplicationStack', {
        containerImageObjectKey: 'app.tar.gz',
        containerImageWithFaultObjectKey: 'app-fault.tar.gz',
        uploaderFunction,
      });

      const template = Template.fromStack(appStack);
      const repositories = findResourcesByType(template, 'AWS::ECR::Repository');
      const cwAgentRepo = repositories.find((repo: any) =>
        repo.Properties?.RepositoryName?.includes('cloudwatch-agent'),
      );
      expect(cwAgentRepo).toBeDefined();
    });

    test('exposes application image URI', () => {
      const appStack = new ApplicationStack(parentStack, 'ApplicationStack', {
        containerImageObjectKey: 'app.tar.gz',
        containerImageWithFaultObjectKey: 'app-fault.tar.gz',
        uploaderFunction,
      });

      expect(appStack.applicationImage).toBeDefined();
      expect(typeof appStack.applicationImage).toBe('string');
      expect(appStack.applicationImage).toContain(':latest');
    });

    test('exposes fault image URI', () => {
      const appStack = new ApplicationStack(parentStack, 'ApplicationStack', {
        containerImageObjectKey: 'app.tar.gz',
        containerImageWithFaultObjectKey: 'app-fault.tar.gz',
        uploaderFunction,
      });

      expect(appStack.applicationFaultImage).toBeDefined();
      expect(typeof appStack.applicationFaultImage).toBe('string');
      expect(appStack.applicationFaultImage).toContain(':fail');
    });

    test('exposes CloudWatch container image URI', () => {
      const appStack = new ApplicationStack(parentStack, 'ApplicationStack', {
        containerImageObjectKey: 'app.tar.gz',
        containerImageWithFaultObjectKey: 'app-fault.tar.gz',
        uploaderFunction,
      });

      expect(appStack.cloudwatchContainerImage).toBeDefined();
      expect(typeof appStack.cloudwatchContainerImage).toBe('string');
    });
  });

  describe('Lambda uploader function', () => {
    test('uses provided uploader function', () => {
      const appStack = new ApplicationStack(parentStack, 'ApplicationStack', {
        containerImageObjectKey: 'app.tar.gz',
        containerImageWithFaultObjectKey: 'app-fault.tar.gz',
        uploaderFunction,
      });

      // The uploader function is passed in, not created in this stack
      expect(appStack.uploaderFunction).toBeDefined();
      expect(appStack.uploaderFunction).toBe(uploaderFunction);
    });

    test('exposes uploader function as public property', () => {
      const appStack = new ApplicationStack(parentStack, 'ApplicationStack', {
        containerImageObjectKey: 'app.tar.gz',
        containerImageWithFaultObjectKey: 'app-fault.tar.gz',
        uploaderFunction,
      });

      expect(appStack.uploaderFunction).toBeDefined();
    });
  });

  describe('CodeBuild project', () => {
    test('creates CodeBuild project', () => {
      const appStack = new ApplicationStack(parentStack, 'ApplicationStack', {
        containerImageObjectKey: 'app.tar.gz',
        containerImageWithFaultObjectKey: 'app-fault.tar.gz',
        uploaderFunction,
      });

      const template = Template.fromStack(appStack);
      template.resourceCountIs('AWS::CodeBuild::Project', 1);
    });

    test('configures CodeBuild with ARM architecture', () => {
      const appStack = new ApplicationStack(parentStack, 'ApplicationStack', {
        containerImageObjectKey: 'app.tar.gz',
        containerImageWithFaultObjectKey: 'app-fault.tar.gz',
        uploaderFunction,
      });

      const template = Template.fromStack(appStack);
      template.hasResourceProperties('AWS::CodeBuild::Project', {
        Environment: Match.objectLike({
          Image: Match.stringLikeRegexp('aarch64'),
        }),
      });
    });

    test('enables privileged mode for Docker', () => {
      const appStack = new ApplicationStack(parentStack, 'ApplicationStack', {
        containerImageObjectKey: 'app.tar.gz',
        containerImageWithFaultObjectKey: 'app-fault.tar.gz',
        uploaderFunction,
      });

      const template = Template.fromStack(appStack);
      template.hasResourceProperties('AWS::CodeBuild::Project', {
        Environment: Match.objectLike({
          PrivilegedMode: true,
        }),
      });
    });

    test('creates IAM role for CodeBuild', () => {
      const appStack = new ApplicationStack(parentStack, 'ApplicationStack', {
        containerImageObjectKey: 'app.tar.gz',
        containerImageWithFaultObjectKey: 'app-fault.tar.gz',
        uploaderFunction,
      });

      const template = Template.fromStack(appStack);
      const roles = findResourcesByType(template, 'AWS::IAM::Role');
      const codeBuildRole = roles.find((role: any) => {
        const assumedBy = role.Properties?.AssumeRolePolicyDocument?.Statement?.[0]?.Principal?.Service;
        return assumedBy === 'codebuild.amazonaws.com' ||
               (Array.isArray(assumedBy) && assumedBy.includes('codebuild.amazonaws.com'));
      });
      expect(codeBuildRole).toBeDefined();
    });

    test('creates log group for CodeBuild', () => {
      const appStack = new ApplicationStack(parentStack, 'ApplicationStack', {
        containerImageObjectKey: 'app.tar.gz',
        containerImageWithFaultObjectKey: 'app-fault.tar.gz',
        uploaderFunction,
      });

      const template = Template.fromStack(appStack);
      const logGroups = findResourcesByType(template, 'AWS::Logs::LogGroup');
      const codeBuildLogGroup = logGroups.find((lg: any) =>
        lg.Properties?.LogGroupName?.['Fn::Join']?.[1]?.some((part: any) =>
          typeof part === 'string' && part.includes('/aws/codebuild/'),
        ),
      );
      expect(codeBuildLogGroup).toBeDefined();
    });

    test('exposes build project as public property', () => {
      const appStack = new ApplicationStack(parentStack, 'ApplicationStack', {
        containerImageObjectKey: 'app.tar.gz',
        containerImageWithFaultObjectKey: 'app-fault.tar.gz',
        uploaderFunction,
      });

      expect(appStack.containerBuildProject).toBeDefined();
    });
  });

  describe('custom resources for container upload', () => {
    test('creates custom resources for container images', () => {
      const appStack = new ApplicationStack(parentStack, 'ApplicationStack', {
        containerImageObjectKey: 'app.tar.gz',
        containerImageWithFaultObjectKey: 'app-fault.tar.gz',
        uploaderFunction,
      });

      const template = Template.fromStack(appStack);
      // Custom resources are created with AWS::CloudFormation::CustomResource type
      const customResources = findResourcesByType(template, 'AWS::CloudFormation::CustomResource');
      expect(customResources.length).toBeGreaterThan(0);
    });

    test('configures custom resource with S3 bucket reference', () => {
      const appStack = new ApplicationStack(parentStack, 'ApplicationStack', {
        containerImageObjectKey: 'app.tar.gz',
        containerImageWithFaultObjectKey: 'app-fault.tar.gz',
        uploaderFunction,
      });

      const template = Template.fromStack(appStack);
      const customResources = findResourcesByType(template, 'AWS::CloudFormation::CustomResource');
      expect(customResources.length).toBeGreaterThan(0);
      const hasS3Bucket = customResources.some((cr: any) => cr.Properties?.Bucket !== undefined);
      expect(hasS3Bucket).toBe(true);
    });

    test('configures custom resource with object key', () => {
      const appStack = new ApplicationStack(parentStack, 'ApplicationStack', {
        containerImageObjectKey: 'custom-app.tar.gz',
        containerImageWithFaultObjectKey: 'custom-app-fault.tar.gz',
        uploaderFunction,
      });

      const template = Template.fromStack(appStack);
      const customResources = findResourcesByType(template, 'AWS::CloudFormation::CustomResource');
      const appResource = customResources.find((cr: any) => {
        const key = cr.Properties?.Key;
        if (key?.['Fn::Join']) {
          const parts = key['Fn::Join'][1] || [];
          return parts.some((part: any) => typeof part === 'string' && part.includes('custom-app.tar.gz'));
        }
        return false;
      });
      expect(appResource).toBeDefined();
    });
  });

  describe('stack parameters', () => {
    test('uses provided container image object key', () => {
      const appStack = new ApplicationStack(parentStack, 'ApplicationStack', {
        containerImageObjectKey: 'my-app.tar.gz',
        containerImageWithFaultObjectKey: 'my-app-fault.tar.gz',
        uploaderFunction,
      });

      const template = Template.fromStack(appStack);
      const customResources = findResourcesByType(template, 'AWS::CloudFormation::CustomResource');
      const hasCorrectKey = customResources.some((cr: any) => {
        const key = cr.Properties?.Key;
        if (key?.['Fn::Join']) {
          const parts = key['Fn::Join'][1] || [];
          return parts.some((part: any) => typeof part === 'string' && part.includes('my-app.tar.gz'));
        }
        return false;
      });
      expect(hasCorrectKey).toBe(true);
    });
  });

  describe('CloudFormation resources', () => {
    test('creates all required resource types', () => {
      const appStack = new ApplicationStack(parentStack, 'ApplicationStack', {
        containerImageObjectKey: 'app.tar.gz',
        containerImageWithFaultObjectKey: 'app-fault.tar.gz',
        uploaderFunction,
      });

      const template = Template.fromStack(appStack);
      const repositories = findResourcesByType(template, 'AWS::ECR::Repository');
      expect(repositories.length).toBeGreaterThan(0);
      // Lambda function is now provided externally, not created in this stack
      template.resourceCountIs('AWS::CodeBuild::Project', 1);
    });

    test('creates managed policies for CodeBuild', () => {
      const appStack = new ApplicationStack(parentStack, 'ApplicationStack', {
        containerImageObjectKey: 'app.tar.gz',
        containerImageWithFaultObjectKey: 'app-fault.tar.gz',
        uploaderFunction,
      });

      const template = Template.fromStack(appStack);
      const managedPolicies = findResourcesByType(template, 'AWS::IAM::ManagedPolicy');
      // Should have at least one managed policy for CodeBuild
      expect(managedPolicies.length).toBeGreaterThan(0);
    });
  });
});
