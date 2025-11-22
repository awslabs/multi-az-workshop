import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AZTaggerStack } from '../../../src/cdk/lib/nested-stacks/az-tagger-stack';

describe('AZTaggerStack', () => {
  test('creates Lambda function for AZ tagging', () => {
    const app = new App();
    const parentStack = new Stack(app, 'ParentStack');

    const azTaggerStack = new AZTaggerStack(parentStack, 'AZTaggerStack', {});

    const template = Template.fromStack(azTaggerStack);
    template.resourceCountIs('AWS::Lambda::Function', 1);
  });

  test('creates custom resource', () => {
    const app = new App();
    const parentStack = new Stack(app, 'ParentStack');

    new AZTaggerStack(parentStack, 'AZTaggerStack', {});

    const template = Template.fromStack(parentStack);
    template.resourceCountIs('Custom::AZTagger', 1);
  });
});
