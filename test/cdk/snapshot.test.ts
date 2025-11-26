import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MultiAZWorkshopStack } from '../../src/cdk/lib/multi-az-workshop-stack';

describe('CloudFormation Template Snapshot', () => {
  let sharedApp: App;
  let sharedStack: MultiAZWorkshopStack;
  let sharedTemplate: Template;

  beforeAll(() => {
    sharedApp = new App();
    sharedStack = new MultiAZWorkshopStack(sharedApp, 'SnapshotTestStack', {
      env: { region: 'us-east-1' },
    });
    sharedTemplate = Template.fromStack(sharedStack);
  });

  test('stack matches snapshot', () => {
    expect(sharedTemplate.toJSON()).toMatchSnapshot();
  });
});
