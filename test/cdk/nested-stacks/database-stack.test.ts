import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { DatabaseStack } from '../../../src/cdk/lib/nested-stacks/database-stack';

describe('DatabaseStack', () => {
  test('creates Aurora database cluster', () => {
    const app = new App();
    const parentStack = new Stack(app, 'ParentStack');
    const vpc = new ec2.Vpc(parentStack, 'VPC');

    const dbStack = new DatabaseStack(parentStack, 'DatabaseStack', {
      vpc,
    });

    const template = Template.fromStack(dbStack);
    template.resourceCountIs('AWS::RDS::DBCluster', 1);
  });

  test('exposes database as output', () => {
    const app = new App();
    const parentStack = new Stack(app, 'ParentStack');
    const vpc = new ec2.Vpc(parentStack, 'VPC');

    const dbStack = new DatabaseStack(parentStack, 'DatabaseStack', {
      vpc,
    });

    expect(dbStack.database).toBeDefined();
  });
});
