import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { IpV6NetworkStack } from '../../../src/cdk/lib/nested-stacks/ipv6-network-stack';

describe('IpV6NetworkStack', () => {
  test('creates VPC with correct AZ configuration', () => {
    const app = new App();
    const parentStack = new Stack(app, 'ParentStack');

    const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
      availabilityZoneNames: ['us-east-1a', 'us-east-1b', 'us-east-1c'],
    });

    const template = Template.fromStack(networkStack);
    template.resourceCountIs('AWS::EC2::VPC', 1);
  });

  test('exposes VPC as output', () => {
    const app = new App();
    const parentStack = new Stack(app, 'ParentStack');

    const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
      availabilityZoneNames: ['us-east-1a', 'us-east-1b', 'us-east-1c'],
    });

    expect(networkStack.vpc).toBeDefined();
  });
});
