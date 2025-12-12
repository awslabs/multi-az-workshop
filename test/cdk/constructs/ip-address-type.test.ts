// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { IPAddressType } from '../../../src/cdk/lib/constructs/ip-address-type';

describe('IPAddressType', () => {
  describe('enum values', () => {
    test('contains IPv4 value', () => {
      expect(IPAddressType.IPv4).toBeDefined();
      expect(IPAddressType.IPv4).toBe(0);
    });

    test('contains DualStack value', () => {
      expect(IPAddressType.DualStack).toBeDefined();
      expect(IPAddressType.DualStack).toBe(1);
    });

    test('contains IPv6 value', () => {
      expect(IPAddressType.IPv6).toBeDefined();
      expect(IPAddressType.IPv6).toBe(2);
    });

    test('all enum values are accessible', () => {
      const values = Object.values(IPAddressType).filter(v => typeof v === 'number');
      expect(values).toHaveLength(3);
      expect(values).toContain(0);
      expect(values).toContain(1);
      expect(values).toContain(2);
    });
  });

  describe('enum value equality', () => {
    test('IPv4 equals 0', () => {
      expect(IPAddressType.IPv4).toEqual(0);
    });

    test('DualStack equals 1', () => {
      expect(IPAddressType.DualStack).toEqual(1);
    });

    test('IPv6 equals 2', () => {
      expect(IPAddressType.IPv6).toEqual(2);
    });

    test('enum values are distinct', () => {
      expect(IPAddressType.IPv4).not.toEqual(IPAddressType.DualStack);
      expect(IPAddressType.IPv4).not.toEqual(IPAddressType.IPv6);
      expect(IPAddressType.DualStack).not.toEqual(IPAddressType.IPv6);
    });
  });
});
