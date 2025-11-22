// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Evacuation method for handling availability zone failures
 */
export enum EvacuationMethod {
  /**
   * Application Recovery Controller (ARC) based evacuation
   */
  ARC = 'ARC',

  /**
   * Route 53 Zonal Shift based evacuation
   */
  ZonalShift = 'ZonalShift',

  /**
   * Self-managed HTTP endpoint using S3
   */
  SelfManagedHttpEndpoint_S3 = 'SelfManagedHttpEndpoint_S3',

  /**
   * Self-managed HTTP endpoint using API Gateway
   */
  SelfManagedHttpEndpoint_APIG = 'SelfManagedHttpEndpoint_APIG',
}
