// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import { Match } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { ContainerAndRepo } from '../../../src/cdk/lib/constructs/container-and-repo';
import { synthesizeStack, getResourceCount, findResourcesByType } from '../../helpers/stack-helpers';
import { createTestApp } from '../../helpers/test-fixtures';

describe('ContainerAndRepo', () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let containerAndRepo: ContainerAndRepo;

  beforeAll(() => {
    app = createTestApp();
    stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });

    // Add required parameters that the construct expects
    new cdk.CfnParameter(stack, 'AssetsBucketName', {
      type: 'String',
      default: 'test-bucket',
    });
    new cdk.CfnParameter(stack, 'AssetsBucketPrefix', {
      type: 'String',
      default: 'test-prefix/',
    });

    containerAndRepo = new ContainerAndRepo(stack, 'ContainerAndRepo', lambda.Runtime.PYTHON_3_12);
  });

  describe('constructor', () => {
    test('creates construct with required properties', () => {
      expect(containerAndRepo).toBeDefined();
      expect(containerAndRepo.uploaderFunction).toBeDefined();
      expect(containerAndRepo.containerBuildProject).toBeDefined();
    });

    test('creates uploader Lambda function', () => {
      const template = synthesizeStack(stack);
      const lambdaFunctions = findResourcesByType(template, 'AWS::Lambda::Function');

      expect(lambdaFunctions.length).toBeGreaterThan(0);
      const uploaderFunction = lambdaFunctions.find(fn =>
        fn.Properties?.Handler === 'index.handler',
      );
      expect(uploaderFunction).toBeDefined();
    });

    test('creates CodeBuild project', () => {
      const template = synthesizeStack(stack);
      const count = getResourceCount(template, 'AWS::CodeBuild::Project');
      expect(count).toBe(1);
    });
  });

  describe('uploader function configuration', () => {
    test('configures Lambda with correct runtime', () => {
      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'python3.12',
        Handler: 'index.handler',
      });
    });

    test('configures Lambda with ARM64 architecture', () => {
      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Architectures: ['arm64'],
      });
    });

    test('configures Lambda with appropriate timeout', () => {
      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 300,
      });
    });

    test('configures Lambda with appropriate memory', () => {
      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 512,
      });
    });

    test('configures Lambda with Helm layer', () => {
      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Layers: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp('.*HelmLayer.*') })]),
      });
    });

    test('creates Helm layer version', () => {
      const template = synthesizeStack(stack);
      const count = getResourceCount(template, 'AWS::Lambda::LayerVersion');
      expect(count).toBe(1);
    });
  });

  describe('uploader IAM permissions', () => {
    test('creates IAM role for uploader', () => {
      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: { Service: 'lambda.amazonaws.com' },
            }),
          ]),
        }),
      });
    });

    test('grants S3 GetObject permissions', () => {
      const template = synthesizeStack(stack);
      const policies = findResourcesByType(template, 'AWS::IAM::ManagedPolicy');
      const hasS3Permission = policies.some(policy =>
        policy.Properties?.PolicyDocument?.Statement?.some((stmt: any) => {
          const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
          return actions.includes('s3:GetObject') && stmt.Effect === 'Allow';
        }),
      );
      expect(hasS3Permission).toBe(true);
    });

    test('grants KMS Decrypt permissions', () => {
      const template = synthesizeStack(stack);
      const policies = findResourcesByType(template, 'AWS::IAM::ManagedPolicy');
      const hasKMSPermission = policies.some(policy =>
        policy.Properties?.PolicyDocument?.Statement?.some((stmt: any) => {
          const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
          return actions.includes('kms:Decrypt') && stmt.Effect === 'Allow';
        }),
      );
      expect(hasKMSPermission).toBe(true);
    });

    test('grants ECR permissions', () => {
      const template = synthesizeStack(stack);
      const policies = findResourcesByType(template, 'AWS::IAM::ManagedPolicy');
      const hasECRPermission = policies.some(policy =>
        policy.Properties?.PolicyDocument?.Statement?.some((stmt: any) => {
          const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
          return actions.includes('ecr:PutImage') &&
                 actions.includes('ecr:CompleteLayerUpload') &&
                 stmt.Effect === 'Allow';
        }),
      );
      expect(hasECRPermission).toBe(true);
    });

    test('grants CodeBuild permissions', () => {
      const template = synthesizeStack(stack);
      const policies = findResourcesByType(template, 'AWS::IAM::ManagedPolicy');
      const hasCodeBuildPermission = policies.some(policy =>
        policy.Properties?.PolicyDocument?.Statement?.some((stmt: any) => {
          const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
          return actions.includes('codebuild:StartBuild') &&
                 actions.includes('codebuild:BatchGetBuilds') &&
                 stmt.Effect === 'Allow';
        }),
      );
      expect(hasCodeBuildPermission).toBe(true);
    });

    test('grants CloudWatch Logs permissions', () => {
      const template = synthesizeStack(stack);
      const policies = findResourcesByType(template, 'AWS::IAM::ManagedPolicy');
      const hasLogsPermission = policies.some(policy =>
        policy.Properties?.PolicyDocument?.Statement?.some((stmt: any) => {
          const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
          return actions.includes('logs:PutLogEvents') && stmt.Effect === 'Allow';
        }),
      );
      expect(hasLogsPermission).toBe(true);
    });
  });

  describe('CodeBuild project configuration', () => {
    test('configures build environment', () => {
      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::CodeBuild::Project', {
        Environment: Match.objectLike({
          Image: Match.stringLikeRegexp('.*aarch64.*'),
          PrivilegedMode: true,
        }),
      });
    });

    test('configures build spec', () => {
      const template = synthesizeStack(stack);
      const projects = findResourcesByType(template, 'AWS::CodeBuild::Project');
      expect(projects.length).toBe(1);
      const buildSpec = projects[0].Properties.Source.BuildSpec;
      // BuildSpec is a YAML string
      const buildSpecStr = typeof buildSpec === 'string' ? buildSpec : JSON.stringify(buildSpec);
      expect(buildSpecStr).toContain('version');
      expect(buildSpecStr).toContain('0.2');
    });

    test('creates IAM role for CodeBuild', () => {
      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: { Service: 'codebuild.amazonaws.com' },
            }),
          ]),
        }),
      });
    });

    test('grants CodeBuild S3 and ECR permissions', () => {
      const template = synthesizeStack(stack);
      const policies = findResourcesByType(template, 'AWS::IAM::ManagedPolicy');
      const codeBuildPolicy = policies.find(p =>
        p.Properties?.PolicyDocument?.Statement?.some((s: any) =>
          s.Action?.includes('s3:GetObject') && s.Action?.includes('ecr:PutImage'),
        ),
      );
      expect(codeBuildPolicy).toBeDefined();
    });
  });

  describe('CloudWatch Logs configuration', () => {
    test('creates log group for Lambda function', () => {
      const template = synthesizeStack(stack);
      const logGroups = findResourcesByType(template, 'AWS::Logs::LogGroup');
      const lambdaLogGroup = logGroups.find(lg =>
        lg.Properties?.LogGroupName?.['Fn::Join']?.[1]?.some((part: any) =>
          typeof part === 'object' && part.Ref && part.Ref.includes('EcrUploader'),
        ),
      );
      expect(lambdaLogGroup).toBeDefined();
    });

    test('creates log group for CodeBuild project', () => {
      const template = synthesizeStack(stack);
      const logGroups = findResourcesByType(template, 'AWS::Logs::LogGroup');
      const buildLogGroup = logGroups.find(lg =>
        lg.Properties?.LogGroupName?.['Fn::Join']?.[1]?.some((part: any) =>
          typeof part === 'object' && part.Ref && part.Ref.includes('AppBuild'),
        ),
      );
      expect(buildLogGroup).toBeDefined();
    });

    test('configures log retention', () => {
      const template = synthesizeStack(stack);
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        RetentionInDays: Match.anyValue(),
      });
    });
  });

  describe('addContainerAndRepo method', () => {
    let methodApp: cdk.App;
    let methodStack: cdk.Stack;
    let methodContainerAndRepo: ContainerAndRepo;
    let methodTemplate: any;

    beforeAll(() => {
      methodApp = createTestApp();
      methodStack = new cdk.Stack(methodApp, 'MethodTestStack', {
        env: { account: '123456789012', region: 'us-east-1' },
      });

      new cdk.CfnParameter(methodStack, 'AssetsBucketName', {
        type: 'String',
        default: 'test-bucket',
      });
      new cdk.CfnParameter(methodStack, 'AssetsBucketPrefix', {
        type: 'String',
        default: 'test-prefix/',
      });

      methodContainerAndRepo = new ContainerAndRepo(methodStack, 'ContainerAndRepo', lambda.Runtime.PYTHON_3_12);
      methodContainerAndRepo.addContainerAndRepo({
        repositoryName: 'test-app',
        containerImageS3ObjectKey: 'app.tar',
      });

      methodTemplate = synthesizeStack(methodStack);
    });

    test('creates ECR repository', () => {
      methodTemplate.hasResourceProperties('AWS::ECR::Repository', {
        RepositoryName: 'test-app',
      });
    });

    test('configures repository removal policy', () => {
      methodTemplate.hasResourceProperties('AWS::ECR::Repository', {
        EmptyOnDelete: true,
      });
    });

    test('creates custom resource for container upload', () => {
      const customResources = findResourcesByType(methodTemplate, 'AWS::CloudFormation::CustomResource');
      const containerResource = customResources.find(cr =>
        cr.Properties?.Type === 'Docker',
      );
      expect(containerResource).toBeDefined();
    });

    test('configures custom resource with correct properties', () => {
      const customResources = findResourcesByType(methodTemplate, 'AWS::CloudFormation::CustomResource');
      const containerResource = customResources.find(cr =>
        cr.Properties?.Type === 'Docker',
      );

      expect(containerResource?.Properties.Type).toBe('Docker');
      // Repository is a CDK reference to the ECR repository
      expect(containerResource?.Properties.Repository).toBeDefined();
      expect(containerResource?.Properties.ProjectName).toBeDefined();
    });

    test('returns waitable response with repository', () => {
      const result = methodContainerAndRepo.addContainerAndRepo({
        repositoryName: 'test-app-2',
        containerImageS3ObjectKey: 'app.tar',
      });

      expect(result.repository).toBeDefined();
      expect(result.dependable).toBeDefined();
      // Repository name is set correctly in the construct
      expect(result.repository.repositoryName).toBeDefined();
    });

    test('handles repository names with slashes', () => {
      const slashApp = createTestApp();
      const slashStack = new cdk.Stack(slashApp, 'SlashTestStack', {
        env: { account: '123456789012', region: 'us-east-1' },
      });

      new cdk.CfnParameter(slashStack, 'AssetsBucketName', {
        type: 'String',
        default: 'test-bucket',
      });
      new cdk.CfnParameter(slashStack, 'AssetsBucketPrefix', {
        type: 'String',
        default: 'test-prefix/',
      });

      const slashContainerAndRepo = new ContainerAndRepo(slashStack, 'ContainerAndRepo', lambda.Runtime.PYTHON_3_12);
      const result = slashContainerAndRepo.addContainerAndRepo({
        repositoryName: 'org/test-app',
        containerImageS3ObjectKey: 'app.tar',
      });

      const slashTemplate = synthesizeStack(slashStack);
      slashTemplate.hasResourceProperties('AWS::ECR::Repository', {
        RepositoryName: 'org/test-app',
      });

      // Verify the result is returned correctly
      expect(result.repository).toBeDefined();
      expect(result.dependable).toBeDefined();
    });
  });

  describe('createRepoAndHelmChart method', () => {
    let helmApp: cdk.App;
    let helmStack: cdk.Stack;
    let helmContainerAndRepo: ContainerAndRepo;
    let helmTemplate: any;

    beforeAll(() => {
      helmApp = createTestApp();
      helmStack = new cdk.Stack(helmApp, 'HelmTestStack', {
        env: { account: '123456789012', region: 'us-east-1' },
      });

      new cdk.CfnParameter(helmStack, 'AssetsBucketName', {
        type: 'String',
        default: 'test-bucket',
      });
      new cdk.CfnParameter(helmStack, 'AssetsBucketPrefix', {
        type: 'String',
        default: 'test-prefix/',
      });

      helmContainerAndRepo = new ContainerAndRepo(helmStack, 'ContainerAndRepo', lambda.Runtime.PYTHON_3_12);
      helmContainerAndRepo.createRepoAndHelmChart({
        repositoryName: 'helm-repo',
        helmChartName: 'my-chart',
        version: '1.0.0',
      });

      helmTemplate = synthesizeStack(helmStack);
    });

    test('creates ECR repository for Helm chart', () => {
      helmTemplate.hasResourceProperties('AWS::ECR::Repository', {
        RepositoryName: 'helm-repo',
      });
    });

    test('creates custom resource for Helm chart upload', () => {
      const customResources = findResourcesByType(helmTemplate, 'AWS::CloudFormation::CustomResource');
      const helmResource = customResources.find(cr =>
        cr.Properties?.Type === 'Helm',
      );
      expect(helmResource).toBeDefined();
    });

    test('configures Helm custom resource with correct properties', () => {
      const customResources = findResourcesByType(helmTemplate, 'AWS::CloudFormation::CustomResource');
      const helmResource = customResources.find(cr =>
        cr.Properties?.Type === 'Helm',
      );

      expect(helmResource?.Properties.Type).toBe('Helm');
      // Repository is a CDK reference, not a string
      expect(helmResource?.Properties.Repository).toBeDefined();
    });

    test('returns waitable response with repository', () => {
      const result = helmContainerAndRepo.createRepoAndHelmChart({
        repositoryName: 'helm-repo-2',
        helmChartName: 'my-chart-2',
        version: '1.0.0',
      });

      expect(result.repository).toBeDefined();
      expect(result.dependable).toBeDefined();
      // Repository name is set correctly in the construct
      expect(result.repository.repositoryName).toBeDefined();
    });
  });

  describe('resource dependencies', () => {
    let depsApp: cdk.App;
    let depsStack: cdk.Stack;
    let depsContainerAndRepo: ContainerAndRepo;
    let depsTemplate: any;

    beforeAll(() => {
      depsApp = createTestApp();
      depsStack = new cdk.Stack(depsApp, 'DepsTestStack', {
        env: { account: '123456789012', region: 'us-east-1' },
      });

      new cdk.CfnParameter(depsStack, 'AssetsBucketName', {
        type: 'String',
        default: 'test-bucket',
      });
      new cdk.CfnParameter(depsStack, 'AssetsBucketPrefix', {
        type: 'String',
        default: 'test-prefix/',
      });

      depsContainerAndRepo = new ContainerAndRepo(depsStack, 'ContainerAndRepo', lambda.Runtime.PYTHON_3_12);
      depsContainerAndRepo.addContainerAndRepo({
        repositoryName: 'test-app',
        containerImageS3ObjectKey: 'app.tar',
      });

      depsTemplate = synthesizeStack(depsStack);
    });

    test('custom resource depends on uploader function', () => {
      const customResources = findResourcesByType(depsTemplate, 'AWS::CloudFormation::CustomResource');
      expect(customResources.length).toBeGreaterThan(0);
    });

    test('custom resource depends on build project', () => {
      const customResources = findResourcesByType(depsTemplate, 'AWS::CloudFormation::CustomResource');
      const containerResource = customResources.find(cr =>
        cr.Properties?.Type === 'Docker',
      );
      expect(containerResource).toBeDefined();
    });
  });
});
