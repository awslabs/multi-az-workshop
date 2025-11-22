import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { NetworkBuilder } from '../../../src/cdk/lib/constructs/network-builder';

describe('NetworkBuilder', () => {
  test('creates VPC with correct configuration', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    new NetworkBuilder(stack, 'TestNetwork', {
      cidr: '10.0.0.0/16',
      maxAzs: 3,
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::EC2::VPC', 1);
    template.hasResourceProperties('AWS::EC2::VPC', {
      CidrBlock: '10.0.0.0/16',
      EnableDnsHostnames: true,
      EnableDnsSupport: true,
    });
  });
});
