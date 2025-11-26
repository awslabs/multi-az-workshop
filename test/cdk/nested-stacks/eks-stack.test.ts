import * as cdk from 'aws-cdk-lib';
import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as rds from 'aws-cdk-lib/aws-rds';
import { IPAddressType } from '../../../src/cdk/lib/constructs/ip-address-type';
import { VpcIpV6, IVpcIpV6 } from '../../../src/cdk/lib/constructs/vpc-ipv6-construct';
import { EKSStack } from '../../../src/cdk/lib/nested-stacks/eks-stack';
import { synthesizeStack, findResourcesByType } from '../../helpers/stack-helpers';

// Mock the EKSStack module to avoid file system dependencies
jest.mock('../../../src/cdk/lib/nested-stacks/eks-stack', () => {
  const actual = jest.requireActual('../../../src/cdk/lib/nested-stacks/eks-stack');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs');
  const originalReadFileSync = fs.readFileSync;

  // Override readFileSync only for this module
  fs.readFileSync = jest.fn((path: any, options?: any) => {
    if (path.toString().includes('versions.json')) {
      return JSON.stringify({
        EKS: '1.32',
        HELM: '3.16.3',
        KUBECTL: '1.32.0',
        ISTIO: '1.24.1',
        LB_CONTROLLER_HELM: '1.10.1',
        LB_CONTROLLER_CONTAINER: 'v2.8.1',
      });
    }
    return originalReadFileSync(path, options);
  });

  return actual;
});


describe('EKSStack', () => {
  let app: App;
  let parentStack: Stack;
  let vpc: IVpcIpV6;
  let database: rds.DatabaseCluster;
  let loadBalancerSecurityGroup: ec2.SecurityGroup;
  let adminRoleName: string;
  let sharedEksStack: EKSStack;
  let sharedTemplate: Template;
  let sharedParentTemplate: Template;

  beforeAll(() => {
    app = new App();
    parentStack = new Stack(app, 'ParentStack', {
      env: { region: 'us-east-1', account: '123456789012' },
    });

    // Add required parameters for NestedStackWithSource
    new cdk.CfnParameter(parentStack, 'AssetsBucketName', {
      type: 'String',
      default: 'test-bucket',
    });
    new cdk.CfnParameter(parentStack, 'AssetsBucketPrefix', {
      type: 'String',
      default: 'test-prefix/',
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

    // Create admin role
    const adminRole = new iam.Role(parentStack, 'AdminRole', {
      assumedBy: new iam.AccountPrincipal(parentStack.account),
      roleName: 'test-admin-role',
    });
    adminRoleName = adminRole.roleName;

    // Create shared EKS stack and template
    sharedEksStack = new EKSStack(parentStack, 'EKSStack', {
      vpc,
      database,
      loadBalancerSecurityGroup,
      adminRoleName,
    });
    sharedTemplate = Template.fromStack(sharedEksStack);
    sharedParentTemplate = Template.fromStack(parentStack);
  });

  describe('stack creation', () => {
    test('synthesizes without errors', () => {
      expect(() => synthesizeStack(sharedEksStack)).not.toThrow();
    });

    test('creates nested stack resource', () => {
      const nestedStacks = findResourcesByType(sharedParentTemplate, 'AWS::CloudFormation::Stack');
      expect(nestedStacks.length).toBeGreaterThan(0);
    });
  });

  describe('EKS cluster creation', () => {
    test('creates EKS cluster', () => {
      sharedTemplate.resourceCountIs('Custom::AWSCDK-EKS-Cluster', 1);
    });

    test('configures cluster with specified name', () => {
      sharedTemplate.hasResourceProperties('Custom::AWSCDK-EKS-Cluster', {
        Config: Match.objectLike({
          name: 'multi-az-workshop-eks-cluster',
        }),
      });
    });

    test('creates cluster with admin role access', () => {
      const clusters = findResourcesByType(sharedTemplate, 'Custom::AWSCDK-EKS-Cluster');
      expect(clusters.length).toBe(1);
      expect(clusters[0].Properties.Config.roleArn).toBeDefined();
    });
  });

  describe('node group configuration', () => {
    test('creates node group', () => {
      const nodeGroups = findResourcesByType(sharedTemplate, 'AWS::EKS::Nodegroup');
      expect(nodeGroups.length).toBeGreaterThan(0);
    });

    test('configures node group with VPC subnets', () => {
      sharedTemplate.hasResourceProperties('AWS::EKS::Nodegroup', {
        Subnets: Match.anyValue(),
      });
    });
  });

  describe('IAM roles and policies', () => {
    test('creates IAM roles for cluster', () => {
      const roles = findResourcesByType(sharedTemplate, 'AWS::IAM::Role');
      expect(roles.length).toBeGreaterThan(0);
    });

    test('creates service account for AWS Load Balancer Controller', () => {
      const serviceAccounts = findResourcesByType(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource');
      const saResources = serviceAccounts.filter((sa: any) => {
        const manifest = sa.Properties?.Manifest;
        if (typeof manifest === 'string') {
          return manifest.includes('ServiceAccount');
        }
        return JSON.stringify(manifest).includes('ServiceAccount');
      });
      expect(saResources.length).toBeGreaterThan(0);
    });
  });

  describe('VPC and subnet configuration', () => {
    test('uses provided VPC', () => {
      const clusters = findResourcesByType(sharedTemplate, 'Custom::AWSCDK-EKS-Cluster');
      expect(clusters.length).toBe(1);
      expect(clusters[0].Properties.Config.resourcesVpcConfig).toBeDefined();
    });

    test('creates security groups for cluster', () => {
      const securityGroups = findResourcesByType(sharedTemplate, 'AWS::EC2::SecurityGroup');
      expect(securityGroups.length).toBeGreaterThan(0);
    });
  });

  describe('stack parameters and outputs', () => {
    test('inherits AssetsBucketName parameter from parent', () => {
      const parameters = sharedTemplate.toJSON().Parameters || {};
      expect(parameters.AssetsBucketName).toBeDefined();
    });

    test('inherits AssetsBucketPrefix parameter from parent', () => {
      const parameters = sharedTemplate.toJSON().Parameters || {};
      expect(parameters.AssetsBucketPrefix).toBeDefined();
    });

    test('exposes target group as public property', () => {
      expect(sharedEksStack.eksAppTargetGroup).toBeDefined();
    });
  });

  describe('Istio installation', () => {
    test('installs Istio components', () => {
      const helmCharts = findResourcesByType(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart');
      const istioCharts = helmCharts.filter((chart: any) => {
        const chartName = chart.Properties?.Chart;
        const repository = chart.Properties?.Repository;
        const chartStr = typeof chartName === 'string' ? chartName : JSON.stringify(chartName);
        const repoStr = typeof repository === 'string' ? repository : JSON.stringify(repository);
        return chartStr.includes('istio') || repoStr.includes('istio');
      });
      expect(istioCharts.length).toBeGreaterThan(0);
    });
  });

  describe('AWS Load Balancer Controller installation', () => {
    test('installs AWS Load Balancer Controller', () => {
      const helmCharts = findResourcesByType(sharedTemplate, 'Custom::AWSCDK-EKS-HelmChart');
      const lbControllerCharts = helmCharts.filter((chart: any) =>
        chart.Properties?.Chart?.includes('aws-load-balancer-controller'),
      );
      expect(lbControllerCharts.length).toBeGreaterThan(0);
    });
  });

  describe('application deployment', () => {
    test('deploys EKS application', () => {
      const k8sResources = findResourcesByType(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource');
      expect(k8sResources.length).toBeGreaterThan(0);
    });

    test('creates namespace for application', () => {
      const k8sResources = findResourcesByType(sharedTemplate, 'Custom::AWSCDK-EKS-KubernetesResource');
      const namespaces = k8sResources.filter((resource: any) => {
        const manifest = resource.Properties?.Manifest;
        if (typeof manifest === 'string') {
          return manifest.includes('Namespace');
        }
        return JSON.stringify(manifest).includes('Namespace');
      });
      expect(namespaces.length).toBeGreaterThan(0);
    });
  });

  describe('CloudFormation resources', () => {
    test('creates ECR repositories', () => {
      const repositories = findResourcesByType(sharedTemplate, 'AWS::ECR::Repository');
      expect(repositories.length).toBeGreaterThan(0);
    });
  });
});
