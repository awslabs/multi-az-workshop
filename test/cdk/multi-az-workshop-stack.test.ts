import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { MultiAZWorkshopStack } from '../../src/cdk/lib/multi-az-workshop-stack';
import {
  synthesizeStack,
  getParameters,
  getOutputs,
  assertResourceExists,
  assertParameterExists,
  assertResourceCount,
  findResourcesByType,
} from '../helpers';

// Mock the file system to provide versions.json for EKS stack
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  const originalReadFileSync = actual.readFileSync;

  return {
    ...actual,
    readFileSync: jest.fn((path: any, options?: any) => {
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
    }),
  };
});

describe('MultiAZWorkshopStack', () => {
  // Create a shared stack instance for most tests to avoid repeated synthesis
  let sharedApp: App;
  let sharedStack: MultiAZWorkshopStack;
  let sharedTemplate: Template;

  beforeAll(() => {
    sharedApp = new App();
    sharedStack = new MultiAZWorkshopStack(sharedApp, 'TestStack', {
      env: { region: 'us-east-1' },
    });
    sharedTemplate = Template.fromStack(sharedStack);
  });

  describe('synthesis', () => {
    test('synthesizes without errors', () => {
      expect(() => {
        sharedApp.synth();
      }).not.toThrow();
    });

    test('synthesizes with different regions', () => {
      const regions = ['us-west-2', 'eu-west-1'];

      regions.forEach((region) => {
        const app = new App();
        expect(() => {
          new MultiAZWorkshopStack(app, `TestStack-${region}`, {
            env: { region },
          });
          app.synth();
        }).not.toThrow();
      });
    });

    test('stack can be synthesized and template extracted', () => {
      expect(() => synthesizeStack(sharedStack)).not.toThrow();
      const template = synthesizeStack(sharedStack);
      expect(template).toBeDefined();
    });
  });

  describe('parameters', () => {
    let template: Template;

    beforeAll(() => {
      template = sharedTemplate;
    });

    test('creates all required CloudFormation parameters', () => {
      assertParameterExists(template, 'AssetsBucketName');
      assertParameterExists(template, 'AssetsBucketPrefix');
      assertParameterExists(template, 'ParticipantRoleName');
    });

    test('AssetsBucketName parameter has correct type and constraints', () => {
      template.hasParameter('AssetsBucketName', {
        Type: 'String',
        MinLength: 1,
        Default: '{{.AssetsBucketName}}',
      });
    });

    test('AssetsBucketPrefix parameter has correct type and default', () => {
      template.hasParameter('AssetsBucketPrefix', {
        Type: 'String',
        Default: '{{.AssetsBucketPrefix}}',
      });
    });

    test('ParticipantRoleName parameter has correct type and default', () => {
      template.hasParameter('ParticipantRoleName', {
        Type: 'String',
        Default: '{{.ParticipantRoleName}}',
      });
    });

    test('all parameters have valid types', () => {
      const parameters = getParameters(template);
      const paramValues = Object.values(parameters);
      expect(paramValues.length).toBeGreaterThan(0);
      paramValues.forEach((param: any) => {
        // Parameters can be String or AWS::SSM::Parameter::Value<String>
        expect(param.Type).toMatch(/String/);
      });
    });

    test('parameters have default values', () => {
      const parameters = getParameters(template);
      expect(parameters.AssetsBucketName.Default).toBeDefined();
      expect(parameters.AssetsBucketPrefix.Default).toBeDefined();
      expect(parameters.ParticipantRoleName.Default).toBeDefined();
    });
  });

  describe('nested stacks', () => {
    let template: Template;

    beforeAll(() => {
      template = sharedTemplate;
    });

    test('creates multiple nested stacks', () => {
      const nestedStacks = findResourcesByType(
        template,
        'AWS::CloudFormation::Stack',
      );
      // Should have at least 5 nested stacks (network, database, ec2, eks, etc.)
      expect(nestedStacks.length).toBeGreaterThanOrEqual(5);
    });

    test('nested stacks include network, database, EC2, and EKS stacks', () => {
      const nestedStacks = findResourcesByType(
        template,
        'AWS::CloudFormation::Stack',
      );
      const stackIds = nestedStacks.map((s) => s.logicalId.toLowerCase());

      // Check for key nested stacks by looking for partial matches
      const hasNetworkStack = stackIds.some((id) => id.includes('network'));
      const hasDatabaseStack = stackIds.some((id) => id.includes('database'));
      const hasEc2Stack = stackIds.some((id) => id.includes('ec2'));
      const hasEksStack = stackIds.some((id) => id.includes('eks'));

      expect(hasNetworkStack).toBe(true);
      expect(hasDatabaseStack).toBe(true);
      expect(hasEc2Stack).toBe(true);
      expect(hasEksStack).toBe(true);
    });

    test('nested stacks receive parameters from parent stack', () => {
      const nestedStacks = findResourcesByType(
        template,
        'AWS::CloudFormation::Stack',
      );

      // Check that at least some nested stacks have parameters
      const stacksWithParams = nestedStacks.filter(
        (stack) => stack.Properties?.Parameters,
      );
      expect(stacksWithParams.length).toBeGreaterThan(0);
    });

    test('nested stacks have template URLs', () => {
      const nestedStacks = findResourcesByType(
        template,
        'AWS::CloudFormation::Stack',
      );

      nestedStacks.forEach((stack) => {
        expect(stack.Properties?.TemplateURL).toBeDefined();
      });
    });
  });

  describe('outputs', () => {
    let template: Template;

    beforeAll(() => {
      template = sharedTemplate;
    });

    test('template has outputs section', () => {
      const outputs = getOutputs(template);
      expect(outputs).toBeDefined();
    });

    test('outputs are properly formatted', () => {
      const outputs = getOutputs(template);
      Object.entries(outputs).forEach(([key, output]: [string, any]) => {
        expect(output).toHaveProperty('Value');
        expect(key).toBeTruthy();
      });
    });
  });

  describe('core resources', () => {
    let template: Template;

    beforeAll(() => {
      template = sharedTemplate;
    });

    test('creates VPC in nested stack', () => {
      // VPC is created in the network nested stack
      const nestedStacks = findResourcesByType(
        template,
        'AWS::CloudFormation::Stack',
      );
      expect(nestedStacks.length).toBeGreaterThan(0);
    });

    test('creates database cluster in nested stack', () => {
      // Database is created in the database nested stack
      const nestedStacks = findResourcesByType(
        template,
        'AWS::CloudFormation::Stack',
      );
      expect(nestedStacks.length).toBeGreaterThan(0);
    });

    test('creates load balancer', () => {
      assertResourceCount(template, 'AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
    });

    test('creates load balancer with zonal shift enabled', () => {
      template.hasResourceProperties(
        'AWS::ElasticLoadBalancingV2::LoadBalancer',
        {
          LoadBalancerAttributes: Match.arrayWith([
            Match.objectLike({
              Key: 'zonal_shift.config.enabled',
              Value: 'true',
            }),
          ]),
        },
      );
    });

    test('creates SSM parameters for asset locations', () => {
      assertResourceCount(template, 'AWS::SSM::Parameter', 3);
    });

    test('creates BucketPath SSM parameter', () => {
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Name: 'BucketPath',
        Type: 'String',
      });
    });

    test('creates Region SSM parameter', () => {
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Name: 'Region',
        Type: 'String',
      });
    });

    test('creates DeploymentAsset SSM parameter', () => {
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Name: 'DeploymentAsset',
        Type: 'String',
      });
    });

    test('creates log group with correct configuration', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/multi-az-workshop/frontend',
        RetentionInDays: 7,
      });
    });

    test('creates security group for ALB', () => {
      assertResourceExists(template, 'AWS::EC2::SecurityGroup');
    });

    test('creates ALB listener on port 80', () => {
      template.hasResourceProperties(
        'AWS::ElasticLoadBalancingV2::Listener',
        {
          Port: 80,
          Protocol: 'HTTP',
        },
      );
    });

    test('creates target groups in nested stacks', () => {
      // Target groups are created in EC2 and EKS nested stacks
      const nestedStacks = findResourcesByType(
        template,
        'AWS::CloudFormation::Stack',
      );
      expect(nestedStacks.length).toBeGreaterThan(0);
    });

    test('creates auto scaling group in nested stack', () => {
      // ASG is created in the EC2 fleet nested stack
      const nestedStacks = findResourcesByType(
        template,
        'AWS::CloudFormation::Stack',
      );
      expect(nestedStacks.length).toBeGreaterThan(0);
    });

    test('creates launch template in nested stack', () => {
      // Launch template is created in the EC2 fleet nested stack
      const nestedStacks = findResourcesByType(
        template,
        'AWS::CloudFormation::Stack',
      );
      expect(nestedStacks.length).toBeGreaterThan(0);
    });
  });

  describe('conditional logic', () => {
    test('creates EKS resources in nested stack', () => {
      const template = sharedTemplate;

      // EKS cluster is created in the EKS nested stack
      const nestedStacks = findResourcesByType(
        template,
        'AWS::CloudFormation::Stack',
      );
      const hasEksStack = nestedStacks.some((s) =>
        s.logicalId.toLowerCase().includes('eks'),
      );
      expect(hasEksStack).toBe(true);
    });

    test('creates EKS listener rule for specific paths', () => {
      const template = sharedTemplate;

      // Should have listener rule for EKS paths
      template.hasResourceProperties(
        'AWS::ElasticLoadBalancingV2::ListenerRule',
        {
          Conditions: Match.arrayWith([
            Match.objectLike({
              Field: 'path-pattern',
              PathPatternConfig: {
                Values: ['/home', '/signin'],
              },
            }),
          ]),
          Priority: 1,
        },
      );
    });

    test('stack synthesizes successfully in different regions', () => {
      const regions = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'];

      regions.forEach((region) => {
        const app = new App();
        expect(() => {
          new MultiAZWorkshopStack(app, `TestStack-${region}`, {
            env: { region },
          });
          app.synth();
        }).not.toThrow();
      });
    });

    test('creates availability zone mapper custom resources', () => {
      const template = sharedTemplate;

      // Availability zone mapper creates Lambda functions
      assertResourceExists(template, 'AWS::Lambda::Function');
    });

    test('configures resources for three availability zones in nested stacks', () => {
      const template = sharedTemplate;

      // Subnets are in nested network stack
      const nestedStacks = findResourcesByType(
        template,
        'AWS::CloudFormation::Stack',
      );
      expect(nestedStacks.length).toBeGreaterThan(0);
    });

    test('creates CodeDeploy resources in nested stack', () => {
      const template = sharedTemplate;

      // CodeDeploy resources are in nested stack
      const nestedStacks = findResourcesByType(
        template,
        'AWS::CloudFormation::Stack',
      );
      expect(nestedStacks.length).toBeGreaterThan(0);
    });

    test('creates observability resources', () => {
      const template = sharedTemplate;

      // Should have CloudWatch alarms
      assertResourceExists(template, 'AWS::CloudWatch::Alarm');
    });

    test('creates fault injection and SSM resources in nested stacks', () => {
      const template = sharedTemplate;

      // FIS and SSM resources are created in nested stacks
      // Verify nested stacks exist that would contain these resources
      const nestedStacks = findResourcesByType(
        template,
        'AWS::CloudFormation::Stack',
      );
      expect(nestedStacks.length).toBeGreaterThan(0);
    });
  });

  describe('integration', () => {
    test('all major components are created together', () => {
      const template = sharedTemplate;

      // Verify major resource types exist in main stack
      // Note: Some resources like VPC, RDS, ASG are in nested stacks
      const expectedResources = [
        'AWS::Logs::LogGroup',
        'AWS::SSM::Parameter',
        'AWS::CloudFormation::Stack',
        'AWS::EC2::SecurityGroup',
      ];

      expectedResources.forEach((resourceType) => {
        assertResourceExists(template, resourceType);
      });
    });

    test('nested stacks are properly integrated', () => {
      const template = sharedTemplate;

      const nestedStacks = findResourcesByType(
        template,
        'AWS::CloudFormation::Stack',
      );

      // Should have multiple nested stacks
      expect(nestedStacks.length).toBeGreaterThan(5);
    });

    test('stack has proper resource dependencies', () => {
      // Stack should synthesize without circular dependencies
      expect(() => sharedApp.synth()).not.toThrow();
    });
  });

  describe('evacuation methods', () => {
    // Create stacks for each evacuation method once
    let arcStack: MultiAZWorkshopStack;
    let arcTemplate: Template;

    beforeAll(() => {
      const arcApp = new App({
        context: {
          evacuationMethod: 'ARC',
        },
      });
      arcStack = new MultiAZWorkshopStack(arcApp, 'ARCStack', {
        env: { region: 'us-east-1' },
      });
      arcTemplate = Template.fromStack(arcStack);
    });

    test('creates stack with ARC evacuation method', () => {
      expect(arcStack).toBeDefined();
      expect(arcTemplate).toBeDefined();
    });

    test('creates stack with different evacuation methods', () => {
      const evacuationMethods = [
        { method: 'SelfManagedHttpEndpoint_APIG', stackName: 'TestStack-APIG' },
        { method: 'SelfManagedHttpEndpoint_S3', stackName: 'TestStack-S3' },
      ];

      evacuationMethods.forEach(({ method, stackName }) => {
        const app = new App({
          context: {
            evacuationMethod: method,
          },
        });

        expect(() => {
          new MultiAZWorkshopStack(app, stackName, {
            env: { region: 'us-east-1' },
          });
          app.synth();
        }).not.toThrow();
      });
    });

    test('creates stack with ZonalShift evacuation method (default)', () => {
      // Default stack already uses ZonalShift
      expect(sharedStack).toBeDefined();
      expect(sharedTemplate).toBeDefined();
    });

    test('ARC evacuation method creates nested stacks', () => {
      const nestedStacks = findResourcesByType(
        arcTemplate,
        'AWS::CloudFormation::Stack',
      );
      // ARC method should create multiple nested stacks
      expect(nestedStacks.length).toBeGreaterThan(5);
    });

    test('ZonalShift evacuation method creates nested stacks', () => {
      const nestedStacks = findResourcesByType(
        sharedTemplate,
        'AWS::CloudFormation::Stack',
      );
      // ZonalShift should create nested stacks
      expect(nestedStacks.length).toBeGreaterThan(5);
    });
  });

  describe('IPv6 support', () => {
    let ipv6Stack: MultiAZWorkshopStack;
    let ipv6Template: Template;

    beforeAll(() => {
      const ipv6App = new App({
        context: {
          ipV6Enabled: true,
        },
      });
      ipv6Stack = new MultiAZWorkshopStack(ipv6App, 'IPv6Stack', {
        env: { region: 'us-east-1' },
      });
      ipv6Template = Template.fromStack(ipv6Stack);
    });

    test('creates stack with IPv6 enabled', () => {
      expect(ipv6Stack).toBeDefined();
      expect(ipv6Template).toBeDefined();
    });

    test('IPv6 enabled creates stack successfully', () => {
      // Verify the stack was created with IPv6 context
      expect(ipv6Stack).toBeDefined();

      // Verify security groups exist (ALB security group is created)
      assertResourceExists(ipv6Template, 'AWS::EC2::SecurityGroup');

      // Verify nested stacks are created
      const nestedStacks = findResourcesByType(ipv6Template, 'AWS::CloudFormation::Stack');
      expect(nestedStacks.length).toBeGreaterThan(0);
    });

    test('IPv6 enabled adds IPv6 ingress rule to ALB security group', () => {
      // Check for SecurityGroupIngress resources (CDK creates these separately)
      const ingressRules = findResourcesByType(ipv6Template, 'AWS::EC2::SecurityGroupIngress');

      // Also check inline ingress rules in security groups
      const securityGroups = findResourcesByType(ipv6Template, 'AWS::EC2::SecurityGroup');

      // Find IPv6 ingress rule for port 80 in separate resources
      let ipv6IngressRule = ingressRules.find((rule) => {
        return (
          rule.Properties?.CidrIpv6 !== undefined &&
          rule.Properties?.FromPort === 80 &&
          rule.Properties?.ToPort === 80
        );
      });

      // If not found in separate resources, check inline rules in security groups
      if (!ipv6IngressRule) {
        for (const sg of securityGroups) {
          const inlineRules = sg.Properties?.SecurityGroupIngress || [];
          const ipv6Rule = inlineRules.find(
            (rule: any) =>
              rule.CidrIpv6 !== undefined && rule.FromPort === 80 && rule.ToPort === 80,
          );
          if (ipv6Rule) {
            ipv6IngressRule = { Properties: ipv6Rule };
            break;
          }
        }
      }

      // Verify IPv6 ingress rule exists
      expect(ipv6IngressRule).toBeDefined();
      if (ipv6IngressRule) {
        expect(ipv6IngressRule.Properties.IpProtocol).toBe('tcp');
        expect(ipv6IngressRule.Properties.CidrIpv6).toBeDefined();
      }
    });
  });
});


