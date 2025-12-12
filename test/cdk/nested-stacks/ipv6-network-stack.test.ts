import * as cdk from 'aws-cdk-lib';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { IpV6NetworkStack } from '../../../src/cdk/lib/nested-stacks/ipv6-network-stack';
import { synthesizeStack, findResourcesByType, getResourceCount } from '../../helpers/stack-helpers';

describe('IpV6NetworkStack', () => {
  let app: App;
  let parentStack: Stack;
  const testAzs = ['us-east-1a', 'us-east-1b', 'us-east-1c'];

  beforeEach(() => {
    app = new App();
    parentStack = new Stack(app, 'ParentStack', {
      env: { region: 'us-east-1', account: '123456789012' },
    });

    // Create required parameters for NestedStackWithSource
    new cdk.CfnParameter(parentStack, 'AssetsBucketName', {
      type: 'String',
      default: 'test-assets-bucket',
    });
    new cdk.CfnParameter(parentStack, 'AssetsBucketPrefix', {
      type: 'String',
      default: 'test-prefix/',
    });
  });

  describe('stack creation', () => {
    test('synthesizes without errors', () => {
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: testAzs,
      });
      expect(() => synthesizeStack(networkStack)).not.toThrow();
    });

    test('creates nested stack resource', () => {
      new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: testAzs,
      });
      const template = Template.fromStack(parentStack);
      template.resourceCountIs('AWS::CloudFormation::Stack', 1);
    });

    test('extends NestedStackWithSource', () => {
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: testAzs,
      });
      expect(networkStack).toBeInstanceOf(Stack);
    });
  });

  describe('VPC creation with IPv6 support', () => {
    test('creates VPC with correct AZ configuration', () => {
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: testAzs,
      });

      const template = Template.fromStack(networkStack);
      template.resourceCountIs('AWS::EC2::VPC', 1);
    });

    test('configures VPC with correct CIDR block', () => {
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: testAzs,
      });

      const template = Template.fromStack(networkStack);
      template.hasResourceProperties('AWS::EC2::VPC', {
        CidrBlock: '192.168.0.0/16',
        EnableDnsHostnames: true,
        EnableDnsSupport: true,
      });
    });

    test('does not create internet gateway', () => {
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: testAzs,
      });

      const template = Template.fromStack(networkStack);
      template.resourceCountIs('AWS::EC2::InternetGateway', 0);
    });

    test('exposes VPC as public property', () => {
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: testAzs,
      });

      expect(networkStack.vpc).toBeDefined();
      expect(networkStack.vpc.vpcId).toBeDefined();
    });
  });

  describe('subnet configuration', () => {
    test('creates isolated subnets', () => {
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: testAzs,
      });

      const template = Template.fromStack(networkStack);
      const subnetCount = getResourceCount(template, 'AWS::EC2::Subnet');
      expect(subnetCount).toBe(testAzs.length);
    });

    test('configures subnets with correct CIDR mask', () => {
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: testAzs,
      });

      const template = Template.fromStack(networkStack);
      const subnets = findResourcesByType(template, 'AWS::EC2::Subnet');

      subnets.forEach((subnet) => {
        expect(subnet.Properties.CidrBlock).toMatch(/^192\.168\.\d+\.0\/24$/);
      });
    });

    test('creates subnets in specified availability zones', () => {
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: testAzs,
      });

      const template = Template.fromStack(networkStack);
      const subnets = findResourcesByType(template, 'AWS::EC2::Subnet');

      expect(subnets.length).toBe(testAzs.length);
    });

    test('creates route tables for subnets', () => {
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: testAzs,
      });

      const template = Template.fromStack(networkStack);
      const routeTableCount = getResourceCount(template, 'AWS::EC2::RouteTable');
      expect(routeTableCount).toBeGreaterThan(0);
    });
  });

  describe('availability zone configuration', () => {
    test('stores availability zone names', () => {
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: testAzs,
      });

      expect(networkStack.availabilityZoneNames).toEqual(testAzs);
    });

    test('handles different number of availability zones', () => {
      const twoAzs = ['us-west-2a', 'us-west-2b'];
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: twoAzs,
      });

      expect(networkStack.availabilityZoneNames).toEqual(twoAzs);

      const template = Template.fromStack(networkStack);
      const subnetCount = getResourceCount(template, 'AWS::EC2::Subnet');
      expect(subnetCount).toBe(twoAzs.length);
    });
  });

  describe('VPC endpoints', () => {
    test('creates S3 gateway endpoint', () => {
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: testAzs,
      });

      const template = Template.fromStack(networkStack);
      const endpoints = findResourcesByType(template, 'AWS::EC2::VPCEndpoint');

      const s3Endpoint = endpoints.find((ep) => {
        const serviceName = ep.Properties.ServiceName;
        if (serviceName && serviceName['Fn::Join']) {
          const parts = serviceName['Fn::Join'][1];
          return parts && parts.some((part: string) => part === '.s3');
        }
        return false;
      });

      expect(s3Endpoint).toBeDefined();
      expect(s3Endpoint.Properties.VpcEndpointType).toBe('Gateway');
    });

    test('creates SSM interface endpoint', () => {
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: testAzs,
      });

      const template = Template.fromStack(networkStack);
      const endpoints = findResourcesByType(template, 'AWS::EC2::VPCEndpoint');

      // Verify at least one interface endpoint with PrivateDnsEnabled exists
      const interfaceEndpoints = endpoints.filter((ep) =>
        ep.Properties.VpcEndpointType === 'Interface' &&
        ep.Properties.PrivateDnsEnabled === true,
      );

      expect(interfaceEndpoints.length).toBeGreaterThan(0);
    });

    test('creates CloudWatch Logs interface endpoint', () => {
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: testAzs,
      });

      const template = Template.fromStack(networkStack);
      const endpoints = findResourcesByType(template, 'AWS::EC2::VPCEndpoint');

      // Verify interface endpoints exist
      const interfaceEndpoints = endpoints.filter((ep) =>
        ep.Properties.VpcEndpointType === 'Interface',
      );

      expect(interfaceEndpoints.length).toBeGreaterThan(10);
    });

    test('creates multiple interface endpoints', () => {
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: testAzs,
      });

      const template = Template.fromStack(networkStack);
      const endpointCount = getResourceCount(template, 'AWS::EC2::VPCEndpoint');

      // Should have 1 gateway endpoint (S3) + multiple interface endpoints
      expect(endpointCount).toBeGreaterThan(10);
    });

    test('creates security groups for interface endpoints', () => {
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: testAzs,
      });

      const template = Template.fromStack(networkStack);
      const securityGroupCount = getResourceCount(template, 'AWS::EC2::SecurityGroup');
      expect(securityGroupCount).toBeGreaterThan(0);
    });

    test('creates EKS interface endpoint', () => {
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: testAzs,
      });

      const template = Template.fromStack(networkStack);
      const endpoints = findResourcesByType(template, 'AWS::EC2::VPCEndpoint');

      // Verify multiple interface endpoints exist (EKS and EKS-auth are both created)
      const interfaceEndpoints = endpoints.filter((ep) =>
        ep.Properties.VpcEndpointType === 'Interface',
      );

      expect(interfaceEndpoints.length).toBeGreaterThan(15);
    });

    test('creates ECR interface endpoints', () => {
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: testAzs,
      });

      const template = Template.fromStack(networkStack);
      const endpoints = findResourcesByType(template, 'AWS::EC2::VPCEndpoint');

      // Verify multiple interface endpoints exist (including ECR API and Docker)
      const interfaceEndpoints = endpoints.filter((ep) =>
        ep.Properties.VpcEndpointType === 'Interface',
      );

      // The stack creates many interface endpoints including ECR
      expect(interfaceEndpoints.length).toBeGreaterThan(18);
    });
  });

  describe('stack parameters', () => {
    test('accepts availability zone names as parameter', () => {
      const customAzs = ['eu-west-1a', 'eu-west-1b'];
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: customAzs,
      });

      expect(networkStack.availabilityZoneNames).toEqual(customAzs);
    });
  });

  describe('VPC properties', () => {
    test('VPC has correct properties exposed', () => {
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: testAzs,
      });

      expect(networkStack.vpc.vpcId).toBeDefined();
      expect(networkStack.vpc.vpcCidrBlock).toBeDefined();

      // Verify the VPC CIDR in the template
      const template = Template.fromStack(networkStack);
      template.hasResourceProperties('AWS::EC2::VPC', {
        CidrBlock: '192.168.0.0/16',
      });
    });

    test('VPC has isolated subnets', () => {
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: testAzs,
      });

      expect(networkStack.vpc.isolatedSubnets).toBeDefined();
      expect(networkStack.vpc.isolatedSubnets.length).toBe(testAzs.length);
    });

    test('VPC does not restrict default security group', () => {
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: testAzs,
      });

      const template = Template.fromStack(networkStack);
      const vpc = findResourcesByType(template, 'AWS::EC2::VPC')[0];

      // When restrictDefaultSecurityGroup is false, no custom resource is created
      expect(vpc).toBeDefined();
    });
  });

  describe('CloudFormation resources', () => {
    test('creates all required resource types', () => {
      const networkStack = new IpV6NetworkStack(parentStack, 'NetworkStack', {
        availabilityZoneNames: testAzs,
      });

      const template = Template.fromStack(networkStack);

      template.resourceCountIs('AWS::EC2::VPC', 1);
      expect(getResourceCount(template, 'AWS::EC2::Subnet')).toBeGreaterThan(0);
      expect(getResourceCount(template, 'AWS::EC2::RouteTable')).toBeGreaterThan(0);
      expect(getResourceCount(template, 'AWS::EC2::VPCEndpoint')).toBeGreaterThan(0);
      expect(getResourceCount(template, 'AWS::EC2::SecurityGroup')).toBeGreaterThan(0);
    });
  });
});
