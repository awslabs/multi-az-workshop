import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { IPAddressType } from '../../../src/cdk/lib/constructs/ip-address-type';
import { VpcIpV6, IVpcIpV6 } from '../../../src/cdk/lib/constructs/vpc-ipv6-construct';
import { DatabaseStack } from '../../../src/cdk/lib/nested-stacks/database-stack';
import { synthesizeStack, findResourcesByType } from '../../helpers/stack-helpers';

describe('DatabaseStack', () => {
  let app: App;
  let parentStack: Stack;
  let vpc: IVpcIpV6;

  beforeEach(() => {
    app = new App();
    parentStack = new Stack(app, 'ParentStack', {
      env: { region: 'us-east-1', account: '123456789012' },
    });
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
  });

  describe('stack creation', () => {
    test('synthesizes without errors', () => {
      const dbStack = new DatabaseStack(parentStack, 'DatabaseStack', { vpc });
      expect(() => synthesizeStack(dbStack)).not.toThrow();
    });

    test('creates nested stack resource', () => {
      new DatabaseStack(parentStack, 'DatabaseStack', { vpc });
      const template = Template.fromStack(parentStack);
      template.resourceCountIs('AWS::CloudFormation::Stack', 1);
    });
  });

  describe('Aurora PostgreSQL cluster creation', () => {
    test('creates Aurora database cluster', () => {
      const dbStack = new DatabaseStack(parentStack, 'DatabaseStack', { vpc });
      const template = Template.fromStack(dbStack);
      template.resourceCountIs('AWS::RDS::DBCluster', 1);
    });

    test('configures PostgreSQL engine with version 16.1', () => {
      const dbStack = new DatabaseStack(parentStack, 'DatabaseStack', { vpc });
      const template = Template.fromStack(dbStack);

      template.hasResourceProperties('AWS::RDS::DBCluster', {
        Engine: 'aurora-postgresql',
        EngineVersion: Match.stringLikeRegexp('16\\.1'),
      });
    });

    test('creates cluster instance with correct instance type', () => {
      const dbStack = new DatabaseStack(parentStack, 'DatabaseStack', { vpc });
      const template = Template.fromStack(dbStack);

      template.hasResourceProperties('AWS::RDS::DBInstance', {
        DBInstanceClass: 'db.t4g.medium',
        PubliclyAccessible: false,
      });
    });

    test('sets database name to workshop', () => {
      const dbStack = new DatabaseStack(parentStack, 'DatabaseStack', { vpc });
      const template = Template.fromStack(dbStack);

      template.hasResourceProperties('AWS::RDS::DBCluster', {
        DatabaseName: 'workshop',
      });
    });

    test('sets removal policy to DESTROY', () => {
      const dbStack = new DatabaseStack(parentStack, 'DatabaseStack', { vpc });
      const template = Template.fromStack(dbStack);

      // Verify the cluster can be deleted (no deletion protection)
      const clusters = findResourcesByType(template, 'AWS::RDS::DBCluster');
      expect(clusters.length).toBe(1);
      expect(clusters[0].DeletionPolicy).toBe('Delete');
    });
  });

  describe('VPC and subnet placement', () => {
    test('places database in isolated subnets', () => {
      const dbStack = new DatabaseStack(parentStack, 'DatabaseStack', { vpc });
      const template = Template.fromStack(dbStack);

      // Verify subnet group has subnet IDs
      const subnetGroups = findResourcesByType(template, 'AWS::RDS::DBSubnetGroup');
      expect(subnetGroups.length).toBe(1);
      expect(subnetGroups[0].Properties.SubnetIds).toBeDefined();
      expect(Array.isArray(subnetGroups[0].Properties.SubnetIds)).toBe(true);
      expect(subnetGroups[0].Properties.SubnetIds.length).toBeGreaterThan(0);
    });

    test('creates DB subnet group', () => {
      const dbStack = new DatabaseStack(parentStack, 'DatabaseStack', { vpc });
      const template = Template.fromStack(dbStack);

      template.resourceCountIs('AWS::RDS::DBSubnetGroup', 1);
    });

    test('associates cluster with subnet group', () => {
      const dbStack = new DatabaseStack(parentStack, 'DatabaseStack', { vpc });
      const template = Template.fromStack(dbStack);

      const clusters = findResourcesByType(template, 'AWS::RDS::DBCluster');
      expect(clusters.length).toBe(1);
      expect(clusters[0].Properties.DBSubnetGroupName).toBeDefined();
      expect(clusters[0].Properties.DBSubnetGroupName.Ref).toMatch(/database/i);
    });
  });

  describe('security group and connection rules', () => {
    test('creates security group for database', () => {
      const dbStack = new DatabaseStack(parentStack, 'DatabaseStack', { vpc });
      const template = Template.fromStack(dbStack);

      template.resourceCountIs('AWS::EC2::SecurityGroup', 1);
    });

    test('allows connections from VPC CIDR on port 5432', () => {
      const dbStack = new DatabaseStack(parentStack, 'DatabaseStack', { vpc });
      const template = Template.fromStack(dbStack);

      // Check for inline ingress rules in security group
      const securityGroups = findResourcesByType(template, 'AWS::EC2::SecurityGroup');
      expect(securityGroups.length).toBe(1);

      const ingressRules = securityGroups[0].Properties.SecurityGroupIngress;
      expect(ingressRules).toBeDefined();
      expect(Array.isArray(ingressRules)).toBe(true);

      const postgresRule = ingressRules.find((rule: any) =>
        rule.IpProtocol === 'tcp' && rule.FromPort === 5432 && rule.ToPort === 5432,
      );
      expect(postgresRule).toBeDefined();
      expect(postgresRule.CidrIp).toBeDefined();
    });

    test('associates security group with cluster', () => {
      const dbStack = new DatabaseStack(parentStack, 'DatabaseStack', { vpc });
      const template = Template.fromStack(dbStack);

      template.hasResourceProperties('AWS::RDS::DBCluster', {
        VpcSecurityGroupIds: Match.arrayWith([
          Match.objectLike({
            'Fn::GetAtt': Match.arrayWith([
              Match.stringLikeRegexp('database.*SecurityGroup'),
              'GroupId',
            ]),
          }),
        ]),
      });
    });

    test('security group references VPC', () => {
      const dbStack = new DatabaseStack(parentStack, 'DatabaseStack', { vpc });
      const template = Template.fromStack(dbStack);

      const securityGroups = findResourcesByType(template, 'AWS::EC2::SecurityGroup');
      expect(securityGroups.length).toBeGreaterThan(0);
      expect(securityGroups[0].Properties.VpcId).toBeDefined();
    });
  });

  describe('public interface', () => {
    test('exposes database cluster as public property', () => {
      const dbStack = new DatabaseStack(parentStack, 'DatabaseStack', { vpc });
      expect(dbStack.database).toBeDefined();
      expect(dbStack.database.clusterIdentifier).toBeDefined();
    });

    test('database cluster has endpoint address', () => {
      const dbStack = new DatabaseStack(parentStack, 'DatabaseStack', { vpc });
      expect(dbStack.database.clusterEndpoint).toBeDefined();
    });

    test('database cluster has connections property', () => {
      const dbStack = new DatabaseStack(parentStack, 'DatabaseStack', { vpc });
      expect(dbStack.database.connections).toBeDefined();
    });
  });

  describe('CloudFormation resources', () => {
    test('creates all required resource types', () => {
      const dbStack = new DatabaseStack(parentStack, 'DatabaseStack', { vpc });
      const template = Template.fromStack(dbStack);

      template.resourceCountIs('AWS::RDS::DBCluster', 1);
      template.resourceCountIs('AWS::RDS::DBInstance', 1);
      template.resourceCountIs('AWS::RDS::DBSubnetGroup', 1);
      template.resourceCountIs('AWS::EC2::SecurityGroup', 1);
    });

    test('creates secret for database credentials', () => {
      const dbStack = new DatabaseStack(parentStack, 'DatabaseStack', { vpc });
      const template = Template.fromStack(dbStack);

      template.resourceCountIs('AWS::SecretsManager::Secret', 1);
    });

    test('attaches secret to cluster', () => {
      const dbStack = new DatabaseStack(parentStack, 'DatabaseStack', { vpc });
      const template = Template.fromStack(dbStack);

      template.resourceCountIs('AWS::SecretsManager::SecretTargetAttachment', 1);
    });
  });
});
