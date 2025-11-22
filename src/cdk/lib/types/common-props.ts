// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';

/**
 * Common properties for nested stacks
 */
export interface CommonNestedStackProps extends cdk.NestedStackProps {
  /**
   * Availability zone names for the deployment
   */
  readonly availabilityZoneNames: string[];

  /**
   * Assets bucket name for storing deployment artifacts
   */
  readonly assetsBucketName: string;

  /**
   * Assets bucket prefix for organizing artifacts
   */
  readonly assetsBucketPrefix: string;

  /**
   * Participant role name for workshop access
   */
  readonly participantRoleName?: string;
}

/**
 * Common properties for custom constructs
 */
export interface CommonConstructProps {
  /**
   * Availability zone names for the deployment
   */
  readonly availabilityZoneNames?: string[];

  /**
   * Assets bucket name for storing deployment artifacts
   */
  readonly assetsBucketName?: string;

  /**
   * Assets bucket prefix for organizing artifacts
   */
  readonly assetsBucketPrefix?: string;
}
