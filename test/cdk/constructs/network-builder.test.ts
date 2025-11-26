// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { NetworkBuilder, CidrBlock } from '../../../src/cdk/lib/constructs/network-builder';

describe('CidrBlock', () => {
  describe('constructor', () => {
    test('creates CIDR block from string', () => {
      const cidr = new CidrBlock('10.0.0.0/16');

      expect(cidr.cidr).toBe('10.0.0.0/16');
      expect(cidr.mask).toBe(16);
      expect(cidr.networkSize).toBe(65536);
    });

    test('creates CIDR block from IP number and mask', () => {
      const ipNumber = CidrBlock.ipToNumber('10.0.0.0');
      const cidr = new CidrBlock(ipNumber, 16);

      expect(cidr.mask).toBe(16);
      expect(cidr.cidr).toBe('10.0.0.0/16');
    });

    test('throws error when mask not provided with IP number', () => {
      const ipNumber = CidrBlock.ipToNumber('10.0.0.0');

      expect(() => new CidrBlock(ipNumber)).toThrow('Mask is required when providing IP address as number');
    });

    test('calculates correct network size for /24', () => {
      const cidr = new CidrBlock('192.168.1.0/24');

      expect(cidr.networkSize).toBe(256);
    });

    test('calculates correct network size for /8', () => {
      const cidr = new CidrBlock('10.0.0.0/8');

      expect(cidr.networkSize).toBe(16777216);
    });
  });

  describe('IP address methods', () => {
    test('returns correct minimum IP', () => {
      const cidr = new CidrBlock('10.0.0.0/16');

      expect(cidr.minIP()).toBe('10.0.0.0');
    });

    test('returns correct maximum IP', () => {
      const cidr = new CidrBlock('10.0.0.0/16');

      expect(cidr.maxIP()).toBe('10.0.255.255');
    });

    test('returns correct minimum address number', () => {
      const cidr = new CidrBlock('10.0.0.0/16');
      const expected = CidrBlock.ipToNumber('10.0.0.0');

      expect(cidr.minAddress()).toBe(expected);
    });

    test('returns correct maximum address number', () => {
      const cidr = new CidrBlock('10.0.0.0/16');
      const expected = CidrBlock.ipToNumber('10.0.255.255');

      expect(cidr.maxAddress()).toBe(expected);
    });
  });

  describe('nextBlock', () => {
    test('returns next CIDR block', () => {
      const cidr = new CidrBlock('10.0.0.0/16');
      const next = cidr.nextBlock();

      expect(next.cidr).toBe('10.1.0.0/16');
    });

    test('returns correct next block for /24', () => {
      const cidr = new CidrBlock('192.168.1.0/24');
      const next = cidr.nextBlock();

      expect(next.cidr).toBe('192.168.2.0/24');
    });

    test('handles block boundaries correctly', () => {
      const cidr = new CidrBlock('10.0.255.0/24');
      const next = cidr.nextBlock();

      expect(next.cidr).toBe('10.1.0.0/24');
    });
  });

  describe('containsCidr', () => {
    test('returns true when CIDR contains another', () => {
      const parent = new CidrBlock('10.0.0.0/16');
      const child = new CidrBlock('10.0.1.0/24');

      expect(parent.containsCidr(child)).toBe(true);
    });

    test('returns false when CIDR does not contain another', () => {
      const cidr1 = new CidrBlock('10.0.0.0/16');
      const cidr2 = new CidrBlock('192.168.0.0/16');

      expect(cidr1.containsCidr(cidr2)).toBe(false);
    });

    test('returns true when CIDRs are identical', () => {
      const cidr1 = new CidrBlock('10.0.0.0/16');
      const cidr2 = new CidrBlock('10.0.0.0/16');

      expect(cidr1.containsCidr(cidr2)).toBe(true);
    });

    test('returns false when child extends beyond parent', () => {
      const parent = new CidrBlock('10.0.0.0/24');
      const child = new CidrBlock('10.0.0.0/16');

      expect(parent.containsCidr(child)).toBe(false);
    });
  });

  describe('static utility methods', () => {
    test('calculateNetworkMask returns correct mask', () => {
      const mask = CidrBlock.calculateNetworkMask(24);

      expect(mask).toBe('255.255.255.0');
    });

    test('calculateNetworkMask for /16', () => {
      const mask = CidrBlock.calculateNetworkMask(16);

      expect(mask).toBe('255.255.0.0');
    });

    test('calculateNetSize returns correct size', () => {
      const size = CidrBlock.calculateNetSize(24);

      expect(size).toBe(256);
    });

    test('calculateNetSize for /16', () => {
      const size = CidrBlock.calculateNetSize(16);

      expect(size).toBe(65536);
    });

    test('ipToNumber converts IP correctly', () => {
      const num = CidrBlock.ipToNumber('192.168.1.1');

      expect(num).toBe(3232235777);
    });

    test('ipToNumber converts 10.0.0.0 correctly', () => {
      const num = CidrBlock.ipToNumber('10.0.0.0');

      expect(num).toBe(167772160);
    });

    test('ipToNumber throws error for invalid IP', () => {
      expect(() => CidrBlock.ipToNumber('256.0.0.0')).toThrow('is not a valid IP address');
    });

    test('ipToNumber throws error for malformed IP', () => {
      expect(() => CidrBlock.ipToNumber('10.0.0')).toThrow('is not a valid IP address');
    });

    test('numberToIp converts number correctly', () => {
      const ip = CidrBlock.numberToIp(3232235777);

      expect(ip).toBe('192.168.1.1');
    });

    test('numberToIp converts 167772160 correctly', () => {
      const ip = CidrBlock.numberToIp(167772160);

      expect(ip).toBe('10.0.0.0');
    });

    test('numberToIp throws error for invalid number', () => {
      expect(() => CidrBlock.numberToIp(4294967296)).toThrow('is not a valid IP address');
    });

    test('isValidIp returns true for valid IP', () => {
      expect(CidrBlock.isValidIp('192.168.1.1')).toBe(true);
    });

    test('isValidIp returns false for invalid IP with high octet', () => {
      expect(CidrBlock.isValidIp('256.0.0.0')).toBe(false);
    });

    test('isValidIp returns false for malformed IP', () => {
      expect(CidrBlock.isValidIp('10.0.0')).toBe(false);
    });

    test('isValidIp returns false for IP with too many octets', () => {
      expect(CidrBlock.isValidIp('10.0.0.0.0')).toBe(false);
    });

    test('isValidIp returns false for negative octet', () => {
      expect(CidrBlock.isValidIp('10.0.-1.0')).toBe(false);
    });

    test('isValidIp returns false for non-numeric octet', () => {
      expect(CidrBlock.isValidIp('10.0.abc.0')).toBe(false);
    });
  });

  describe('IP conversion round-trip', () => {
    test('ipToNumber and numberToIp are inverse operations', () => {
      const originalIp = '192.168.1.100';
      const num = CidrBlock.ipToNumber(originalIp);
      const convertedIp = CidrBlock.numberToIp(num);

      expect(convertedIp).toBe(originalIp);
    });

    test('round-trip works for 10.0.0.0', () => {
      const originalIp = '10.0.0.0';
      const num = CidrBlock.ipToNumber(originalIp);
      const convertedIp = CidrBlock.numberToIp(num);

      expect(convertedIp).toBe(originalIp);
    });
  });
});

describe('NetworkBuilder', () => {
  describe('constructor', () => {
    test('creates network builder with CIDR', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');

      expect(builder.networkCidr).toBeDefined();
      expect(builder.networkCidr.cidr).toBe('10.0.0.0/16');
    });

    test('initializes with correct network CIDR', () => {
      const builder = new NetworkBuilder('192.168.0.0/16');

      expect(builder.networkCidr.cidr).toBe('192.168.0.0/16');
    });
  });

  describe('addSubnet', () => {
    test('adds single subnet with specified mask', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      const subnet = builder.addSubnet(24);

      expect(subnet).toBe('10.0.0.0/24');
    });

    test('adds multiple subnets sequentially', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      const subnet1 = builder.addSubnet(24);
      const subnet2 = builder.addSubnet(24);

      expect(subnet1).toBe('10.0.0.0/24');
      expect(subnet2).toBe('10.0.1.0/24');
    });

    test('throws error for invalid mask below 16', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');

      expect(() => builder.addSubnet(15)).toThrow('is not a valid network mask');
    });

    test('throws error for invalid mask above 28', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');

      expect(() => builder.addSubnet(29)).toThrow('is not a valid network mask');
    });

    test('accepts mask of 16', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      const subnet = builder.addSubnet(16);

      expect(subnet).toBe('10.0.0.0/16');
    });

    test('accepts mask of 28', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      const subnet = builder.addSubnet(28);

      expect(subnet).toBe('10.0.0.0/28');
    });
  });

  describe('addSubnets', () => {
    test('adds multiple subnets with specified mask', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      const subnets = builder.addSubnets(24, 3);

      expect(subnets).toHaveLength(3);
      expect(subnets[0]).toBe('10.0.0.0/24');
      expect(subnets[1]).toBe('10.0.1.0/24');
      expect(subnets[2]).toBe('10.0.2.0/24');
    });

    test('adds single subnet when count is 1', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      const subnets = builder.addSubnets(24, 1);

      expect(subnets).toHaveLength(1);
      expect(subnets[0]).toBe('10.0.0.0/24');
    });

    test('defaults to count of 1 when not specified', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      const subnets = builder.addSubnets(24);

      expect(subnets).toHaveLength(1);
    });

    test('throws error when subnets exceed available space', () => {
      const builder = new NetworkBuilder('10.0.0.0/24');

      expect(() => builder.addSubnets(24, 2)).toThrow('exceeds remaining space');
    });

    test('allows filling entire network space', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      const subnets = builder.addSubnets(24, 256);

      expect(subnets).toHaveLength(256);
      expect(subnets[0]).toBe('10.0.0.0/24');
      expect(subnets[255]).toBe('10.0.255.0/24');
    });

    test('throws error for invalid mask', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');

      expect(() => builder.addSubnets(15, 1)).toThrow('is not a valid network mask');
    });
  });

  describe('getCidrs', () => {
    test('returns empty array when no subnets added', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');

      expect(builder.getCidrs()).toEqual([]);
    });

    test('returns all added subnet CIDRs', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      builder.addSubnet(24);
      builder.addSubnet(24);
      builder.addSubnet(24);

      const cidrs = builder.getCidrs();
      expect(cidrs).toHaveLength(3);
      expect(cidrs).toEqual(['10.0.0.0/24', '10.0.1.0/24', '10.0.2.0/24']);
    });

    test('returns CIDRs in order added', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      builder.addSubnets(24, 5);

      const cidrs = builder.getCidrs();
      expect(cidrs[0]).toBe('10.0.0.0/24');
      expect(cidrs[4]).toBe('10.0.4.0/24');
    });
  });

  describe('maskForRemainingSubnets', () => {
    test('calculates correct mask for remaining space', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      const mask = builder.maskForRemainingSubnets(256);

      expect(mask).toBe(24);
    });

    test('calculates mask after some subnets added', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      builder.addSubnets(24, 128);
      const mask = builder.maskForRemainingSubnets(128);

      expect(mask).toBe(24);
    });

    test('calculates mask for dividing remaining space', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      const mask = builder.maskForRemainingSubnets(4);

      expect(mask).toBe(18);
    });

    test('calculates mask for single subnet using all remaining space', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      builder.addSubnet(17);
      const mask = builder.maskForRemainingSubnets(1);

      expect(mask).toBe(17);
    });

    test('handles small remaining space', () => {
      const builder = new NetworkBuilder('10.0.0.0/24');
      const mask = builder.maskForRemainingSubnets(16);

      expect(mask).toBe(28);
    });
  });

  describe('network space management', () => {
    test('tracks used space correctly', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      builder.addSubnet(24);
      builder.addSubnet(24);

      const cidrs = builder.getCidrs();
      expect(cidrs).toHaveLength(2);
    });

    test('prevents overlapping subnets', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      const subnet1 = builder.addSubnet(24);
      const subnet2 = builder.addSubnet(24);

      const cidr1 = new CidrBlock(subnet1);
      const cidr2 = new CidrBlock(subnet2);

      expect(cidr1.containsCidr(cidr2)).toBe(false);
      expect(cidr2.containsCidr(cidr1)).toBe(false);
    });

    test('allocates contiguous address space', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      const subnets = builder.addSubnets(24, 3);

      const cidr1 = new CidrBlock(subnets[0]);
      const cidr2 = new CidrBlock(subnets[1]);

      expect(cidr2.minAddress()).toBe(cidr1.maxAddress() + 1);
    });
  });

  describe('different network sizes', () => {
    test('works with /8 network', () => {
      const builder = new NetworkBuilder('10.0.0.0/8');
      const subnet = builder.addSubnet(16);

      expect(subnet).toBe('10.0.0.0/16');
    });

    test('works with /24 network', () => {
      const builder = new NetworkBuilder('192.168.1.0/24');
      const subnet = builder.addSubnet(28);

      expect(subnet).toBe('192.168.1.0/28');
    });

    test('works with /20 network', () => {
      const builder = new NetworkBuilder('172.16.0.0/20');
      const subnets = builder.addSubnets(24, 16);

      expect(subnets).toHaveLength(16);
      expect(subnets[0]).toBe('172.16.0.0/24');
      expect(subnets[15]).toBe('172.16.15.0/24');
    });
  });

  describe('edge cases', () => {
    test('handles filling network exactly', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      const subnets = builder.addSubnets(24, 256);

      expect(subnets).toHaveLength(256);
      expect(() => builder.addSubnet(24)).toThrow('exceeds remaining space');
    });

    test('handles large subnet in small network', () => {
      const builder = new NetworkBuilder('10.0.0.0/24');
      const subnet = builder.addSubnet(24);

      expect(subnet).toBe('10.0.0.0/24');
      expect(() => builder.addSubnet(28)).toThrow('exceeds remaining space');
    });

    test('handles mixed subnet sizes', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      const subnet1 = builder.addSubnet(20);
      const subnet2 = builder.addSubnet(24);
      const subnet3 = builder.addSubnet(22);

      expect(subnet1).toBe('10.0.0.0/20');
      expect(subnet2).toBe('10.0.16.0/24');
      expect(subnet3).toBe('10.0.20.0/22');
    });

    test('handles zero subnets requested', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      const subnets = builder.addSubnets(24, 0);

      expect(subnets).toHaveLength(0);
      expect(builder.getCidrs()).toHaveLength(0);
    });

    test('handles minimum mask value (16)', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      const subnet = builder.addSubnet(16);

      expect(subnet).toBe('10.0.0.0/16');
      expect(() => builder.addSubnet(16)).toThrow('exceeds remaining space');
    });

    test('handles maximum mask value (28)', () => {
      const builder = new NetworkBuilder('10.0.0.0/16');
      const subnets = builder.addSubnets(28, 4096);

      expect(subnets).toHaveLength(4096);
    });

    test('handles boundary IP addresses', () => {
      const builder = new NetworkBuilder('0.0.0.0/8');
      const subnet = builder.addSubnet(16);

      expect(subnet).toBe('0.0.0.0/16');
    });

    test('handles high IP range', () => {
      const builder = new NetworkBuilder('223.255.0.0/16');
      const subnet = builder.addSubnet(24);

      expect(subnet).toBe('223.255.0.0/24');
    });
  });

  describe('CidrBlock edge cases', () => {
    test('handles minimum IP address', () => {
      const cidr = new CidrBlock('0.0.0.0/8');

      expect(cidr.minIP()).toBe('0.0.0.0');
      expect(cidr.maxIP()).toBe('0.255.255.255');
    });

    test('handles maximum valid IP address', () => {
      const cidr = new CidrBlock('255.255.255.0/24');

      expect(cidr.minIP()).toBe('255.255.255.0');
      expect(cidr.maxIP()).toBe('255.255.255.255');
    });

    test('handles /32 CIDR (single IP)', () => {
      const cidr = new CidrBlock('192.168.1.1/32');

      expect(cidr.networkSize).toBe(1);
      expect(cidr.minIP()).toBe(cidr.maxIP());
    });

    test('handles /0 CIDR (entire IPv4 space)', () => {
      const cidr = new CidrBlock('0.0.0.0/0');

      expect(cidr.networkSize).toBe(4294967296);
      expect(cidr.minIP()).toBe('0.0.0.0');
      expect(cidr.maxIP()).toBe('255.255.255.255');
    });

    test('validates IP with leading zeros', () => {
      expect(() => CidrBlock.ipToNumber('010.000.000.001')).not.toThrow();
    });

    test('handles boundary number to IP conversion', () => {
      expect(CidrBlock.numberToIp(0)).toBe('0.0.0.0');
      expect(CidrBlock.numberToIp(4294967295)).toBe('255.255.255.255');
    });

    test('containsCidr with identical masks', () => {
      const cidr1 = new CidrBlock('10.0.0.0/24');
      const cidr2 = new CidrBlock('10.0.1.0/24');

      expect(cidr1.containsCidr(cidr2)).toBe(false);
      expect(cidr2.containsCidr(cidr1)).toBe(false);
    });

    test('containsCidr with adjacent blocks', () => {
      const cidr1 = new CidrBlock('10.0.0.0/24');
      const cidr2 = cidr1.nextBlock();

      expect(cidr1.containsCidr(cidr2)).toBe(false);
      expect(cidr2.containsCidr(cidr1)).toBe(false);
    });
  });

  describe('validation error tests', () => {
    describe('NetworkBuilder validation', () => {
      test('throws error for mask below minimum (15)', () => {
        const builder = new NetworkBuilder('10.0.0.0/16');

        expect(() => builder.addSubnet(15)).toThrow('is not a valid network mask');
      });

      test('throws error for mask above maximum (29)', () => {
        const builder = new NetworkBuilder('10.0.0.0/16');

        expect(() => builder.addSubnet(29)).toThrow('is not a valid network mask');
      });

      test('throws error for mask of 0', () => {
        const builder = new NetworkBuilder('10.0.0.0/16');

        expect(() => builder.addSubnet(0)).toThrow('is not a valid network mask');
      });

      test('throws error for negative mask', () => {
        const builder = new NetworkBuilder('10.0.0.0/16');

        expect(() => builder.addSubnet(-1)).toThrow('is not a valid network mask');
      });

      test('throws error for mask of 32', () => {
        const builder = new NetworkBuilder('10.0.0.0/16');

        expect(() => builder.addSubnet(32)).toThrow('is not a valid network mask');
      });

      test('throws error when exceeding network capacity', () => {
        const builder = new NetworkBuilder('10.0.0.0/24');

        expect(() => builder.addSubnets(24, 2)).toThrow('exceeds remaining space');
      });

      test('throws error when single subnet exceeds capacity', () => {
        const builder = new NetworkBuilder('10.0.0.0/24');
        builder.addSubnet(25);

        expect(() => builder.addSubnet(24)).toThrow('exceeds remaining space');
      });

      test('handles negative subnet count as zero', () => {
        const builder = new NetworkBuilder('10.0.0.0/16');
        const subnets = builder.addSubnets(24, -1);

        expect(subnets).toHaveLength(0);
      });
    });

    describe('CidrBlock validation', () => {
      test('throws error for invalid IP with octet > 255', () => {
        expect(() => CidrBlock.ipToNumber('256.0.0.0')).toThrow('is not a valid IP address');
      });

      test('throws error for invalid IP with octet > 255 in middle', () => {
        expect(() => CidrBlock.ipToNumber('192.300.1.1')).toThrow('is not a valid IP address');
      });

      test('throws error for malformed IP with too few octets', () => {
        expect(() => CidrBlock.ipToNumber('10.0.0')).toThrow('is not a valid IP address');
      });

      test('throws error for malformed IP with too many octets', () => {
        expect(() => CidrBlock.ipToNumber('10.0.0.0.0')).toThrow('is not a valid IP address');
      });

      test('throws error for IP with negative octet', () => {
        expect(() => CidrBlock.ipToNumber('10.0.-1.0')).toThrow('is not a valid IP address');
      });

      test('throws error for IP with non-numeric octet', () => {
        expect(() => CidrBlock.ipToNumber('10.0.abc.0')).toThrow('is not a valid IP address');
      });

      test('throws error for empty IP string', () => {
        expect(() => CidrBlock.ipToNumber('')).toThrow('is not a valid IP address');
      });

      test('throws error for IP with internal spaces', () => {
        expect(CidrBlock.isValidIp('10.0. 0.0')).toBe(false);
      });

      test('throws error for number above IPv4 range', () => {
        expect(() => CidrBlock.numberToIp(4294967296)).toThrow('is not a valid IP address');
      });

      test('throws error for negative IP number', () => {
        expect(() => CidrBlock.numberToIp(-1)).toThrow('is not a valid IP address');
      });

      test('throws error when mask not provided with IP number', () => {
        const ipNumber = CidrBlock.ipToNumber('10.0.0.0');

        expect(() => new CidrBlock(ipNumber)).toThrow('Mask is required when providing IP address as number');
      });

      test('isValidIp returns false for null', () => {
        expect(CidrBlock.isValidIp(null as any)).toBe(false);
      });

      test('isValidIp returns false for undefined', () => {
        expect(CidrBlock.isValidIp(undefined as any)).toBe(false);
      });

      test('isValidIp returns false for empty string', () => {
        expect(CidrBlock.isValidIp('')).toBe(false);
      });

      test('isValidIp returns false for non-string input', () => {
        expect(CidrBlock.isValidIp(12345 as any)).toBe(false);
      });
    });
  });
});
