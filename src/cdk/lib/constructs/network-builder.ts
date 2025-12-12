// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Represents a CIDR block with utilities for IP address manipulation
 */
export class CidrBlock {
  public readonly cidr: string;
  public readonly mask: number;
  public readonly networkSize: number;
  public readonly networkAddress: number;

  constructor(cidrOrIpAddress: string | number, mask?: number) {
    if (typeof cidrOrIpAddress === 'string') {
      // Parse CIDR string
      const parts = cidrOrIpAddress.split('/');
      this.mask = parseInt(parts[1], 10);
      this.networkAddress = CidrBlock.ipToNumber(parts[0]) + CidrBlock.calculateNetSize(this.mask) - 1;
    } else {
      // Use IP address number and mask
      if (mask === undefined) {
        throw new Error('Mask is required when providing IP address as number');
      }
      this.mask = mask;
      this.networkAddress = cidrOrIpAddress + CidrBlock.calculateNetSize(this.mask) - 1;
    }

    this.networkSize = Math.pow(2, 32 - this.mask);
    this.cidr = `${this.minIP()}/${this.mask}`;
  }

  public minIP(): string {
    return CidrBlock.numberToIp(this.minAddress());
  }

  public maxIP(): string {
    return CidrBlock.numberToIp(this.maxAddress());
  }

  public minAddress(): number {
    const div = this.networkAddress % this.networkSize;
    return this.networkAddress - div;
  }

  public maxAddress(): number {
    // min + (2^(32-mask)) - 1 [zero needs to count]
    return this.minAddress() + this.networkSize - 1;
  }

  public nextBlock(): CidrBlock {
    return new CidrBlock(this.maxAddress() + 1, this.mask);
  }

  public containsCidr(other: CidrBlock): boolean {
    return this.maxAddress() >= other.maxAddress() && this.minAddress() <= other.minAddress();
  }

  public static calculateNetworkMask(mask: number): string {
    return CidrBlock.numberToIp(Math.pow(2, 32) - Math.pow(2, 32 - mask));
  }

  public static calculateNetSize(mask: number): number {
    return Math.pow(2, 32 - mask);
  }

  public static ipToNumber(ipAddress: string): number {
    if (!CidrBlock.isValidIp(ipAddress)) {
      throw new Error(`${ipAddress} is not a valid IP address.`);
    }

    let num = 0;
    const parts = ipAddress.split('.').map((x) => parseInt(x, 10));
    for (let i = 0; i < parts.length; i++) {
      num += parts[i] * Math.pow(256, 3 - i);
    }

    return num;
  }

  public static numberToIp(ipNumber: number): string {
    let remaining = ipNumber;
    const address: number[] = [];

    for (let i = 0; i < 4; i++) {
      if (remaining !== 0) {
        address[i] = Math.floor(remaining / Math.pow(256, 3 - i));
        remaining %= Math.pow(256, 3 - i);
      } else {
        address[i] = 0;
      }
    }

    const ipAddress = address.join('.');

    if (!CidrBlock.isValidIp(ipAddress)) {
      throw new Error(`${ipAddress} is not a valid IP address.`);
    }

    return ipAddress;
  }

  public static isValidIp(ipAddress: string): boolean {
    if (typeof ipAddress !== 'string' || !ipAddress) {
      return false;
    }

    const octets = ipAddress.split('.');
    if (octets.length !== 4) {
      return false;
    }

    for (const octet of octets) {
      // Check for spaces or non-numeric characters
      if (octet.trim() !== octet || !/^\d+$/.test(octet)) {
        return false;
      }

      const tmp = parseInt(octet, 10);
      if (tmp > 255 || tmp < 0 || isNaN(tmp)) {
        return false;
      }
    }

    return true;
  }
}

/**
 * Utility class for building network CIDR blocks and subnets
 */
export class NetworkBuilder {
  public readonly networkCidr: CidrBlock;
  private subnetCidrs: CidrBlock[] = [];
  private nextAvailableIp: number;

  constructor(cidr: string) {
    this.networkCidr = new CidrBlock(cidr);
    this.nextAvailableIp = this.networkCidr.minAddress();
  }

  /**
   * Add a single subnet with the specified mask
   */
  public addSubnet(mask: number): string {
    return this.addSubnets(mask, 1)[0];
  }

  /**
   * Add multiple subnets with the specified mask
   */
  public addSubnets(mask: number, count: number = 1): string[] {
    if (mask < 16 || mask > 28) {
      throw new Error(`/${mask} is not a valid network mask.`);
    }

    const maxIp = this.nextAvailableIp + CidrBlock.calculateNetSize(mask) * count;

    if (this.networkCidr.maxAddress() < maxIp - 1) {
      throw new Error(`${count} of /${mask} exceeds remaining space of ${this.networkCidr.cidr}.`);
    }

    const newSubnets: CidrBlock[] = [];

    for (let i = 0; i < count; i++) {
      const subnet = new CidrBlock(this.nextAvailableIp, mask);
      this.nextAvailableIp = subnet.nextBlock().minAddress();
      this.subnetCidrs.push(subnet);
      newSubnets.push(subnet);
    }

    return newSubnets.map((x) => x.cidr);
  }

  /**
   * Get all subnet CIDRs
   */
  public getCidrs(): string[] {
    return this.subnetCidrs.map((x) => x.cidr);
  }

  /**
   * Calculates the largest subnet to create of the given count from the remaining IP space
   */
  public maskForRemainingSubnets(subnetCount: number): number {
    const remaining = this.networkCidr.maxAddress() - this.nextAvailableIp + 1;
    const ipsPerSubnet = Math.floor(remaining / subnetCount);
    return 32 - Math.floor(Math.log2(ipsPerSubnet));
  }
}
