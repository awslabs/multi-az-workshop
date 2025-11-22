import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { VpcIpV6 } from '../../../src/cdk/lib/constructs/vpc-ipv6-construct';

describe('VpcIpV6', () => {
  test('creates VPC with IPv6 support', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    new VpcIpV6(stack, 'TestVPC', {
      availabilityZoneNames: ['us-east-1a', 'us-east-1b', 'us-east-1c'],
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::EC2::VPC', 1);
    template.hasResourceProperties('AWS::EC2::VPC', {
      EnableDnsHostnames: true,
      EnableDnsSupport: true,
    });
  });
});
