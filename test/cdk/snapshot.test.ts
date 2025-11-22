import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MultiAZWorkshopStack } from '../../src/cdk/lib/multi-az-workshop-stack';

describe('CloudFormation Template Snapshot', () => {
  test('stack matches snapshot', () => {
    const app = new App();
    const stack = new MultiAZWorkshopStack(app, 'SnapshotTestStack', {
      env: { region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);
    expect(template.toJSON()).toMatchSnapshot();
  });
});
