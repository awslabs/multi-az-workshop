/**
 * Tests for evacuation-method type
 * Validates the EvacuationMethod enum values
 */

import { EvacuationMethod } from '../../../src/cdk/lib/types/evacuation-method';

describe('EvacuationMethod', () => {
  describe('enum values', () => {
    test('contains ARC value', () => {
      expect(EvacuationMethod.ARC).toBeDefined();
      expect(EvacuationMethod.ARC).toBe('ARC');
    });

    test('contains ZonalShift value', () => {
      expect(EvacuationMethod.ZonalShift).toBeDefined();
      expect(EvacuationMethod.ZonalShift).toBe('ZonalShift');
    });

    test('contains SelfManagedHttpEndpoint_S3 value', () => {
      expect(EvacuationMethod.SelfManagedHttpEndpoint_S3).toBeDefined();
      expect(EvacuationMethod.SelfManagedHttpEndpoint_S3).toBe(
        'SelfManagedHttpEndpoint_S3',
      );
    });

    test('contains SelfManagedHttpEndpoint_APIG value', () => {
      expect(EvacuationMethod.SelfManagedHttpEndpoint_APIG).toBeDefined();
      expect(EvacuationMethod.SelfManagedHttpEndpoint_APIG).toBe(
        'SelfManagedHttpEndpoint_APIG',
      );
    });

    test('contains all expected values', () => {
      const values = Object.values(EvacuationMethod);
      expect(values).toHaveLength(4);
      expect(values).toContain('ARC');
      expect(values).toContain('ZonalShift');
      expect(values).toContain('SelfManagedHttpEndpoint_S3');
      expect(values).toContain('SelfManagedHttpEndpoint_APIG');
    });

    test('all values are accessible', () => {
      expect(() => {
        const arc = EvacuationMethod.ARC;
        const zonalShift = EvacuationMethod.ZonalShift;
        const s3 = EvacuationMethod.SelfManagedHttpEndpoint_S3;
        const apig = EvacuationMethod.SelfManagedHttpEndpoint_APIG;
        return [arc, zonalShift, s3, apig];
      }).not.toThrow();
    });
  });

  describe('enum value equality', () => {
    test('ARC value equals string literal', () => {
      expect(EvacuationMethod.ARC).toBe('ARC');
      expect(EvacuationMethod.ARC === 'ARC').toBe(true);
    });

    test('ZonalShift value equals string literal', () => {
      expect(EvacuationMethod.ZonalShift).toBe('ZonalShift');
      expect(EvacuationMethod.ZonalShift === 'ZonalShift').toBe(true);
    });

    test('SelfManagedHttpEndpoint_S3 value equals string literal', () => {
      expect(EvacuationMethod.SelfManagedHttpEndpoint_S3).toBe(
        'SelfManagedHttpEndpoint_S3',
      );
      expect(
        EvacuationMethod.SelfManagedHttpEndpoint_S3 === 'SelfManagedHttpEndpoint_S3',
      ).toBe(true);
    });

    test('SelfManagedHttpEndpoint_APIG value equals string literal', () => {
      expect(EvacuationMethod.SelfManagedHttpEndpoint_APIG).toBe(
        'SelfManagedHttpEndpoint_APIG',
      );
      expect(
        EvacuationMethod.SelfManagedHttpEndpoint_APIG ===
          'SelfManagedHttpEndpoint_APIG',
      ).toBe(true);
    });

    test('enum values are unique', () => {
      const values = Object.values(EvacuationMethod);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });

  describe('enum usage', () => {
    test('can be used in switch statements', () => {
      const testMethod = (method: EvacuationMethod): string => {
        switch (method) {
          case EvacuationMethod.ARC:
            return 'ARC';
          case EvacuationMethod.ZonalShift:
            return 'ZonalShift';
          case EvacuationMethod.SelfManagedHttpEndpoint_S3:
            return 'S3';
          case EvacuationMethod.SelfManagedHttpEndpoint_APIG:
            return 'APIG';
          default:
            return 'Unknown';
        }
      };

      expect(testMethod(EvacuationMethod.ARC)).toBe('ARC');
      expect(testMethod(EvacuationMethod.ZonalShift)).toBe('ZonalShift');
      expect(testMethod(EvacuationMethod.SelfManagedHttpEndpoint_S3)).toBe('S3');
      expect(testMethod(EvacuationMethod.SelfManagedHttpEndpoint_APIG)).toBe('APIG');
    });

    test('can be used in comparisons', () => {
      const compareMethod = (method: EvacuationMethod, expected: EvacuationMethod): boolean => {
        return method === expected;
      };

      expect(compareMethod(EvacuationMethod.ARC, EvacuationMethod.ARC)).toBe(true);
      expect(compareMethod(EvacuationMethod.ZonalShift, EvacuationMethod.ZonalShift)).toBe(true);
      expect(compareMethod(EvacuationMethod.ARC, EvacuationMethod.ZonalShift)).toBe(false);
    });

    test('can be used in arrays', () => {
      const methods = [
        EvacuationMethod.ARC,
        EvacuationMethod.ZonalShift,
        EvacuationMethod.SelfManagedHttpEndpoint_S3,
        EvacuationMethod.SelfManagedHttpEndpoint_APIG,
      ];

      expect(methods).toHaveLength(4);
      expect(methods).toContain(EvacuationMethod.ARC);
      expect(methods).toContain(EvacuationMethod.ZonalShift);
    });

    test('can be used as object keys', () => {
      const config = {
        [EvacuationMethod.ARC]: 'ARC Configuration',
        [EvacuationMethod.ZonalShift]: 'ZonalShift Configuration',
        [EvacuationMethod.SelfManagedHttpEndpoint_S3]: 'S3 Configuration',
        [EvacuationMethod.SelfManagedHttpEndpoint_APIG]: 'APIG Configuration',
      };

      expect(config[EvacuationMethod.ARC]).toBe('ARC Configuration');
      expect(config[EvacuationMethod.ZonalShift]).toBe('ZonalShift Configuration');
    });
  });
});
