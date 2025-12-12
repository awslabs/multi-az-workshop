/**
 * Tests for common-props type
 * Validates the CommonNestedStackProps and CommonConstructProps interfaces
 */

import * as cdk from 'aws-cdk-lib';
import {
  CommonNestedStackProps,
  CommonConstructProps,
} from '../../../src/cdk/lib/types/common-props';

describe('common-props', () => {
  describe('CommonNestedStackProps', () => {
    test('interface is defined', () => {
      const props: CommonNestedStackProps = {
        availabilityZoneNames: ['us-east-1a', 'us-east-1b'],
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix',
      };

      expect(props).toBeDefined();
      expect(props.availabilityZoneNames).toEqual(['us-east-1a', 'us-east-1b']);
      expect(props.assetsBucketName).toBe('test-bucket');
      expect(props.assetsBucketPrefix).toBe('test-prefix');
    });

    test('extends NestedStackProps', () => {
      const props: CommonNestedStackProps = {
        availabilityZoneNames: ['us-east-1a'],
        assetsBucketName: 'bucket',
        assetsBucketPrefix: 'prefix',
        description: 'Test nested stack',
        timeout: cdk.Duration.minutes(30),
      };

      expect(props.description).toBe('Test nested stack');
      expect(props.timeout).toBeDefined();
    });

    test('includes required properties', () => {
      const props: CommonNestedStackProps = {
        availabilityZoneNames: ['us-east-1a', 'us-east-1b', 'us-east-1c'],
        assetsBucketName: 'my-assets-bucket',
        assetsBucketPrefix: 'assets/',
      };

      expect(props.availabilityZoneNames).toHaveLength(3);
      expect(props.assetsBucketName).toBe('my-assets-bucket');
      expect(props.assetsBucketPrefix).toBe('assets/');
    });

    test('includes optional participantRoleName property', () => {
      const propsWithRole: CommonNestedStackProps = {
        availabilityZoneNames: ['us-east-1a'],
        assetsBucketName: 'bucket',
        assetsBucketPrefix: 'prefix',
        participantRoleName: 'WorkshopParticipant',
      };

      expect(propsWithRole.participantRoleName).toBe('WorkshopParticipant');
    });

    test('participantRoleName is optional', () => {
      const propsWithoutRole: CommonNestedStackProps = {
        availabilityZoneNames: ['us-east-1a'],
        assetsBucketName: 'bucket',
        assetsBucketPrefix: 'prefix',
      };

      expect(propsWithoutRole.participantRoleName).toBeUndefined();
    });

    test('supports multiple availability zones', () => {
      const props: CommonNestedStackProps = {
        availabilityZoneNames: [
          'us-east-1a',
          'us-east-1b',
          'us-east-1c',
          'us-east-1d',
        ],
        assetsBucketName: 'bucket',
        assetsBucketPrefix: 'prefix',
      };

      expect(props.availabilityZoneNames).toHaveLength(4);
      expect(props.availabilityZoneNames[0]).toBe('us-east-1a');
      expect(props.availabilityZoneNames[3]).toBe('us-east-1d');
    });

    test('supports empty availability zones array', () => {
      const props: CommonNestedStackProps = {
        availabilityZoneNames: [],
        assetsBucketName: 'bucket',
        assetsBucketPrefix: 'prefix',
      };

      expect(props.availabilityZoneNames).toHaveLength(0);
    });

    test('supports various bucket name formats', () => {
      const props1: CommonNestedStackProps = {
        availabilityZoneNames: ['us-east-1a'],
        assetsBucketName: 'simple-bucket',
        assetsBucketPrefix: 'prefix',
      };

      const props2: CommonNestedStackProps = {
        availabilityZoneNames: ['us-east-1a'],
        assetsBucketName: 'my-org-assets-bucket-123',
        assetsBucketPrefix: 'prefix',
      };

      expect(props1.assetsBucketName).toBe('simple-bucket');
      expect(props2.assetsBucketName).toBe('my-org-assets-bucket-123');
    });

    test('supports various prefix formats', () => {
      const props1: CommonNestedStackProps = {
        availabilityZoneNames: ['us-east-1a'],
        assetsBucketName: 'bucket',
        assetsBucketPrefix: 'assets/',
      };

      const props2: CommonNestedStackProps = {
        availabilityZoneNames: ['us-east-1a'],
        assetsBucketName: 'bucket',
        assetsBucketPrefix: 'workshop/v1/assets/',
      };

      const props3: CommonNestedStackProps = {
        availabilityZoneNames: ['us-east-1a'],
        assetsBucketName: 'bucket',
        assetsBucketPrefix: '',
      };

      expect(props1.assetsBucketPrefix).toBe('assets/');
      expect(props2.assetsBucketPrefix).toBe('workshop/v1/assets/');
      expect(props3.assetsBucketPrefix).toBe('');
    });
  });

  describe('CommonConstructProps', () => {
    test('interface is defined', () => {
      const props: CommonConstructProps = {
        availabilityZoneNames: ['us-east-1a', 'us-east-1b'],
        assetsBucketName: 'test-bucket',
        assetsBucketPrefix: 'test-prefix',
      };

      expect(props).toBeDefined();
      expect(props.availabilityZoneNames).toEqual(['us-east-1a', 'us-east-1b']);
      expect(props.assetsBucketName).toBe('test-bucket');
      expect(props.assetsBucketPrefix).toBe('test-prefix');
    });

    test('all properties are optional', () => {
      const emptyProps: CommonConstructProps = {};

      expect(emptyProps.availabilityZoneNames).toBeUndefined();
      expect(emptyProps.assetsBucketName).toBeUndefined();
      expect(emptyProps.assetsBucketPrefix).toBeUndefined();
    });

    test('supports partial property sets', () => {
      const props1: CommonConstructProps = {
        availabilityZoneNames: ['us-east-1a'],
      };

      const props2: CommonConstructProps = {
        assetsBucketName: 'bucket',
      };

      const props3: CommonConstructProps = {
        assetsBucketPrefix: 'prefix',
      };

      expect(props1.availabilityZoneNames).toEqual(['us-east-1a']);
      expect(props1.assetsBucketName).toBeUndefined();

      expect(props2.assetsBucketName).toBe('bucket');
      expect(props2.availabilityZoneNames).toBeUndefined();

      expect(props3.assetsBucketPrefix).toBe('prefix');
      expect(props3.assetsBucketName).toBeUndefined();
    });

    test('supports multiple availability zones', () => {
      const props: CommonConstructProps = {
        availabilityZoneNames: ['us-east-1a', 'us-east-1b', 'us-east-1c'],
      };

      expect(props.availabilityZoneNames).toHaveLength(3);
    });

    test('supports empty availability zones array', () => {
      const props: CommonConstructProps = {
        availabilityZoneNames: [],
      };

      expect(props.availabilityZoneNames).toHaveLength(0);
    });

    test('supports various bucket configurations', () => {
      const props: CommonConstructProps = {
        assetsBucketName: 'my-construct-bucket',
        assetsBucketPrefix: 'constructs/v2/',
      };

      expect(props.assetsBucketName).toBe('my-construct-bucket');
      expect(props.assetsBucketPrefix).toBe('constructs/v2/');
    });
  });

  describe('type exports', () => {
    test('CommonNestedStackProps is exported', () => {
      const props: CommonNestedStackProps = {
        availabilityZoneNames: ['us-east-1a'],
        assetsBucketName: 'bucket',
        assetsBucketPrefix: 'prefix',
      };

      expect(props).toBeDefined();
    });

    test('CommonConstructProps is exported', () => {
      const props: CommonConstructProps = {};

      expect(props).toBeDefined();
    });

    test('both types can be used together', () => {
      const nestedProps: CommonNestedStackProps = {
        availabilityZoneNames: ['us-east-1a'],
        assetsBucketName: 'bucket',
        assetsBucketPrefix: 'prefix',
      };

      const constructProps: CommonConstructProps = {
        availabilityZoneNames: nestedProps.availabilityZoneNames,
        assetsBucketName: nestedProps.assetsBucketName,
        assetsBucketPrefix: nestedProps.assetsBucketPrefix,
      };

      expect(constructProps.availabilityZoneNames).toEqual(
        nestedProps.availabilityZoneNames,
      );
      expect(constructProps.assetsBucketName).toBe(nestedProps.assetsBucketName);
      expect(constructProps.assetsBucketPrefix).toBe(nestedProps.assetsBucketPrefix);
    });
  });

  describe('type completeness', () => {
    test('CommonNestedStackProps has all expected properties', () => {
      const props: CommonNestedStackProps = {
        availabilityZoneNames: ['us-east-1a'],
        assetsBucketName: 'bucket',
        assetsBucketPrefix: 'prefix',
        participantRoleName: 'role',
        description: 'description',
      };

      const keys = Object.keys(props);
      expect(keys).toContain('availabilityZoneNames');
      expect(keys).toContain('assetsBucketName');
      expect(keys).toContain('assetsBucketPrefix');
      expect(keys).toContain('participantRoleName');
      expect(keys).toContain('description');
    });

    test('CommonConstructProps has all expected properties', () => {
      const props: CommonConstructProps = {
        availabilityZoneNames: ['us-east-1a'],
        assetsBucketName: 'bucket',
        assetsBucketPrefix: 'prefix',
      };

      const keys = Object.keys(props);
      expect(keys).toContain('availabilityZoneNames');
      expect(keys).toContain('assetsBucketName');
      expect(keys).toContain('assetsBucketPrefix');
    });

    test('CommonNestedStackProps includes NestedStackProps properties', () => {
      const props: CommonNestedStackProps = {
        availabilityZoneNames: ['us-east-1a'],
        assetsBucketName: 'bucket',
        assetsBucketPrefix: 'prefix',
        description: 'Test stack',
        timeout: cdk.Duration.minutes(15),
        parameters: { key: 'value' },
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      };

      expect(props.description).toBe('Test stack');
      expect(props.timeout).toBeDefined();
      expect(props.parameters).toEqual({ key: 'value' });
      expect(props.removalPolicy).toBe(cdk.RemovalPolicy.DESTROY);
    });
  });

  describe('real-world usage patterns', () => {
    test('can be used for nested stack configuration', () => {
      const stackProps: CommonNestedStackProps = {
        availabilityZoneNames: ['us-east-1a', 'us-east-1b', 'us-east-1c'],
        assetsBucketName: 'workshop-assets-bucket',
        assetsBucketPrefix: 'multi-az-workshop/',
        participantRoleName: 'WorkshopParticipantRole',
        description: 'Multi-AZ Workshop Nested Stack',
      };

      expect(stackProps.availabilityZoneNames).toHaveLength(3);
      expect(stackProps.assetsBucketName).toContain('workshop');
      expect(stackProps.participantRoleName).toContain('Workshop');
    });

    test('can be used for construct configuration', () => {
      const constructProps: CommonConstructProps = {
        availabilityZoneNames: ['us-west-2a', 'us-west-2b'],
        assetsBucketName: 'my-construct-assets',
        assetsBucketPrefix: 'constructs/',
      };

      expect(constructProps.availabilityZoneNames?.[0]).toContain('us-west-2');
      expect(constructProps.assetsBucketName).toBeDefined();
    });

    test('supports configuration inheritance pattern', () => {
      const baseConfig: CommonConstructProps = {
        availabilityZoneNames: ['us-east-1a', 'us-east-1b'],
        assetsBucketName: 'shared-bucket',
        assetsBucketPrefix: 'shared/',
      };

      const nestedConfig: CommonNestedStackProps = {
        ...baseConfig,
        availabilityZoneNames: baseConfig.availabilityZoneNames!,
        assetsBucketName: baseConfig.assetsBucketName!,
        assetsBucketPrefix: baseConfig.assetsBucketPrefix!,
        participantRoleName: 'SpecificRole',
      };

      expect(nestedConfig.availabilityZoneNames).toEqual(
        baseConfig.availabilityZoneNames,
      );
      expect(nestedConfig.participantRoleName).toBe('SpecificRole');
    });
  });
});
