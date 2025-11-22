import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MultiAZWorkshopStack } from '../../src/cdk/lib/multi-az-workshop-stack';

describe('MultiAZWorkshopStack', () => {
  test('synthesizes without errors', () => {
    const app = new App();
    
    expect(() => {
      new MultiAZWorkshopStack(app, 'TestStack', {
        env: { region: 'us-east-1' },
      });
      app.synth();
    }).not.toThrow();
  });

  test('creates required CloudFormation parameters', () => {
    const app = new App();
    const stack = new MultiAZWorkshopStack(app, 'TestStack', {
      env: { region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);
    
    template.hasParameter('AssetsBucketName', {
      Type: 'String',
      MinLength: 1,
      Default: '{{.AssetsBucketName}}',
    });

    template.hasParameter('AssetsBucketPrefix', {
      Type: 'String',
      Default: '{{.AssetsBucketPrefix}}',
    });

    template.hasParameter('ParticipantRoleName', {
      Type: 'String',
      Default: '{{.ParticipantRoleName}}',
    });
  });

  test('creates VPC', () => {
    const app = new App();
    const stack = new MultiAZWorkshopStack(app, 'TestStack', {
      env: { region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::EC2::VPC', 1);
  });

  test('creates database cluster', () => {
    const app = new App();
    const stack = new MultiAZWorkshopStack(app, 'TestStack', {
      env: { region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::RDS::DBCluster', 1);
  });

  test('creates load balancer', () => {
    const app = new App();
    const stack = new MultiAZWorkshopStack(app, 'TestStack', {
      env: { region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
  });

  test('creates SSM parameters', () => {
    const app = new App();
    const stack = new MultiAZWorkshopStack(app, 'TestStack', {
      env: { region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::SSM::Parameter', 3);
  });

  test('creates log group', () => {
    const app = new App();
    const stack = new MultiAZWorkshopStack(app, 'TestStack', {
      env: { region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/multi-az-workshop/frontend',
      RetentionInDays: 7,
    });
  });
});
