import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { EnhancedApplicationLoadBalancer } from '../../../src/cdk/lib/constructs/enhanced-load-balancer';

describe('EnhancedApplicationLoadBalancer', () => {
  test('creates ALB with correct configuration', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const vpc = new ec2.Vpc(stack, 'VPC');

    new EnhancedApplicationLoadBalancer(stack, 'TestALB', {
      vpc,
      internetFacing: false,
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internal',
      Type: 'application',
    });
  });

  test('enables HTTP/2 when specified', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const vpc = new ec2.Vpc(stack, 'VPC');

    new EnhancedApplicationLoadBalancer(stack, 'TestALB', {
      vpc,
      http2Enabled: true,
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      LoadBalancerAttributes: [
        { Key: 'routing.http2.enabled', Value: 'true' },
      ],
    });
  });
});
