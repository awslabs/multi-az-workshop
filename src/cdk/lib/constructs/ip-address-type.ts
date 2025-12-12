// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * IP address type for VPC subnets
 */
export enum IPAddressType {
  /** IPv4 only */
  IPv4 = 0,
  /** Dual stack (IPv4 and IPv6) */
  DualStack = 1,
  /** IPv6 only */
  IPv6 = 2,
}
