import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import { IPAddressType } from '../../../src/cdk/lib/constructs/ip-address-type';
import { VpcIpV6, IVpcIpV6 } from '../../../src/cdk/lib/constructs/vpc-ipv6-construct';
import { EC2FleetStack } from '../../../src/cdk/lib/nested-stacks/ec2-fleet-stack';
import { synthesizeStack, findResourcesByType } from '../../helpers/stack-helpers';

describe('EC2FleetStack', () => {
  let app: App;
  let parentStack: Stack;
  let vpc: IVpcIpV6;
  let logGroup: logs.LogGroup;
  let database: rds.DatabaseCluster;
  let loadBalancerSecurityGroup: ec2.SecurityGroup;

  beforeEach(() => {
    app = new App();
    parentStack = new Stack(app, 'ParentStack', {
      env: { region: 'us-east-1', account: '123456789012' },
    });

    // Create VPC
    vpc = new VpcIpV6(parentStack, 'VPC', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      availabilityZones: ['us-east-1a', 'us-east-1b', 'us-east-1c'],
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          subnetIpConfiguration: IPAddressType.IPv4,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          subnetIpConfiguration: IPAddressType.IPv4,
        },
        {
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          subnetIpConfiguration: IPAddressType.IPv4,
        },
      ],
    });

    // Create log group
    logGroup = new logs.LogGroup(parentStack, 'LogGroup', {
      logGroupName: '/aws/test/app',
    });

    // Create database cluster
    database = new rds.DatabaseCluster(parentStack, 'Database', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_1,
      }),
      writer: rds.ClusterInstance.provisioned('writer', {
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    // Create load balancer security group
    loadBalancerSecurityGroup = new ec2.SecurityGroup(parentStack, 'LBSecurityGroup', {
      vpc,
      description: 'Load balancer security group',
    });
  });

  describe('stack creation', () => {
    test('synthesizes without errors', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      expect(() => synthesizeStack(fleetStack)).not.toThrow();
    });

    test('creates nested stack resource', () => {
      new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(parentStack);
      template.resourceCountIs('AWS::CloudFormation::Stack', 1);
    });
  });

  describe('launch template creation', () => {
    test('creates launch template', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      template.resourceCountIs('AWS::EC2::LaunchTemplate', 1);
    });

    test('configures launch template with Amazon Linux 2023', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      const launchTemplates = findResourcesByType(template, 'AWS::EC2::LaunchTemplate');
      expect(launchTemplates.length).toBe(1);
      expect(launchTemplates[0].Properties.LaunchTemplateData.ImageId).toBeDefined();
    });

    test('configures launch template with EBS encryption', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
        LaunchTemplateData: Match.objectLike({
          BlockDeviceMappings: Match.arrayWith([
            Match.objectLike({
              Ebs: Match.objectLike({
                Encrypted: true,
              }),
            }),
          ]),
        }),
      });
    });

    test('requires IMDSv2', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
        LaunchTemplateData: Match.objectLike({
          MetadataOptions: Match.objectLike({
            HttpTokens: 'required',
          }),
        }),
      });
    });

    test('exposes launch template as public property', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      expect(fleetStack.launchTemplate).toBeDefined();
    });
  });

  describe('auto scaling group configuration', () => {
    test('creates auto scaling group', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      template.resourceCountIs('AWS::AutoScaling::AutoScalingGroup', 1);
    });

    test('configures fleet size correctly', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 6,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      template.hasResourceProperties('AWS::AutoScaling::AutoScalingGroup', {
        MinSize: '6',
        MaxSize: '6',
      });
    });

    test('configures ELB health check', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      template.hasResourceProperties('AWS::AutoScaling::AutoScalingGroup', {
        HealthCheckType: 'ELB',
        HealthCheckGracePeriod: 240,
      });
    });

    test('creates lifecycle hook for termination', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      template.resourceCountIs('AWS::AutoScaling::LifecycleHook', 1);
      template.hasResourceProperties('AWS::AutoScaling::LifecycleHook', {
        LifecycleTransition: 'autoscaling:EC2_INSTANCE_TERMINATING',
      });
    });

    test('exposes auto scaling group as public property', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      expect(fleetStack.autoScalingGroup).toBeDefined();
    });
  });

  describe('instance profile and IAM role', () => {
    test('creates IAM role for instances', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      template.resourceCountIs('AWS::IAM::Role', 1);
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: Match.objectLike({
                Service: 'ec2.amazonaws.com',
              }),
            }),
          ]),
        }),
      });
    });

    test('creates instance profile', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      template.resourceCountIs('AWS::IAM::InstanceProfile', 1);
    });

    test('attaches CloudWatch agent policy', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      const roles = findResourcesByType(template, 'AWS::IAM::Role');
      expect(roles.length).toBe(1);
      expect(roles[0].Properties.ManagedPolicyArns).toBeDefined();
      const managedPolicyArns = roles[0].Properties.ManagedPolicyArns;
      expect(managedPolicyArns).toBeDefined();
      expect(Array.isArray(managedPolicyArns)).toBe(true);
      const hasCWPolicy = managedPolicyArns.some((arn: any) =>
        JSON.stringify(arn).includes('CloudWatchAgentAdminPolicy'),
      );
      expect(hasCWPolicy).toBe(true);
    });

    test('creates managed policies for EC2 operations', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      const managedPolicies = findResourcesByType(template, 'AWS::IAM::ManagedPolicy');
      expect(managedPolicies.length).toBeGreaterThan(0);
    });

    test('grants access to database secret', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'secretsmanager:GetSecretValue',
              Effect: 'Allow',
            }),
          ]),
        }),
      });
    });
  });

  describe('user data configuration', () => {
    test('launch template includes user data', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      const launchTemplates = findResourcesByType(template, 'AWS::EC2::LaunchTemplate');
      expect(launchTemplates[0].Properties.LaunchTemplateData.UserData).toBeDefined();
    });
  });

  describe('load balancer target group integration', () => {
    test('creates application target group', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      template.resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 1);
    });

    test('configures target group with HTTP protocol', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
        Protocol: 'HTTP',
        Port: 5000,
        TargetType: 'instance',
      });
    });

    test('configures health check', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
        HealthCheckEnabled: true,
        HealthCheckPath: '/health',
        HealthCheckProtocol: 'HTTP',
        HealthCheckIntervalSeconds: 10,
      });
    });

    test('enables cross-zone load balancing', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      const targetGroups = findResourcesByType(template, 'AWS::ElasticLoadBalancingV2::TargetGroup');
      expect(targetGroups.length).toBe(1);
      const attributes = targetGroups[0].Properties.TargetGroupAttributes;
      expect(attributes).toBeDefined();
      expect(Array.isArray(attributes)).toBe(true);
      const crossZoneAttr = attributes.find((attr: any) =>
        attr.Key === 'load_balancing.cross_zone.enabled',
      );
      expect(crossZoneAttr).toBeDefined();
      expect(crossZoneAttr.Value).toBe('true');
    });

    test('exposes target group as public property', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      expect(fleetStack.targetGroup).toBeDefined();
    });
  });

  describe('security group configuration', () => {
    test('creates security group for instances', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      template.resourceCountIs('AWS::EC2::SecurityGroup', 1);
    });

    test('allows inbound traffic from load balancer', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        port: 8080,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      const securityGroups = findResourcesByType(template, 'AWS::EC2::SecurityGroup');
      expect(securityGroups.length).toBe(1);
      const ingressRules = securityGroups[0].Properties.SecurityGroupIngress;
      expect(ingressRules).toBeDefined();
      expect(Array.isArray(ingressRules)).toBe(true);
      const portRule = ingressRules.find((rule: any) =>
        rule.IpProtocol === 'tcp' && rule.FromPort === 8080 && rule.ToPort === 8080,
      );
      expect(portRule).toBeDefined();
    });

    test('security group references VPC', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      const securityGroups = findResourcesByType(template, 'AWS::EC2::SecurityGroup');
      expect(securityGroups[0].Properties.VpcId).toBeDefined();
    });
  });

  describe('stack parameters', () => {
    test('uses custom port when provided', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        port: 8080,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
        Port: 8080,
      });
    });

    test('uses default port when not provided', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
        Port: 5000,
      });
    });

    test('uses custom CPU architecture when provided', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        cpuArch: ec2.InstanceArchitecture.X86_64,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
        LaunchTemplateData: Match.objectLike({
          InstanceType: Match.stringLikeRegexp('t3a\\.'),
        }),
      });
    });
  });

  describe('CloudFormation resources', () => {
    test('creates all required resource types', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      template.resourceCountIs('AWS::EC2::LaunchTemplate', 1);
      template.resourceCountIs('AWS::AutoScaling::AutoScalingGroup', 1);
      template.resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 1);
      template.resourceCountIs('AWS::EC2::SecurityGroup', 1);
      template.resourceCountIs('AWS::IAM::Role', 1);
      template.resourceCountIs('AWS::IAM::InstanceProfile', 1);
    });

    test('creates SSM parameter for CloudWatch agent config', () => {
      const fleetStack = new EC2FleetStack(parentStack, 'EC2FleetStack', {
        vpc,
        logGroup,
        database,
        loadBalancerSecurityGroup,
        fleetSize: 3,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix/',
      });

      const template = Template.fromStack(fleetStack);
      template.resourceCountIs('AWS::SSM::Parameter', 1);
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Type: 'String',
      });
    });
  });
});
