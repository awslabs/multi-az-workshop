// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';

/**
 * Nested stack that automatically propagates AssetsBucketName and AssetsBucketPrefix parameters
 * from the parent stack
 */
export class NestedStackWithSource extends cdk.NestedStack {
  public readonly assetsBucketName: cdk.CfnParameter;
  public readonly assetsBucketPrefix: cdk.CfnParameter;

  constructor(scope: cdk.Stack, id: string, props?: cdk.NestedStackProps) {
    super(scope, id, NestedStackWithSource.updateBaseParams(scope, props));

    // Create parameters in the nested stack
    this.assetsBucketName = new cdk.CfnParameter(this, 'AssetsBucketName', {
      minLength: 1,
      type: 'String',
    });

    this.assetsBucketPrefix = new cdk.CfnParameter(this, 'AssetsBucketPrefix', {
      type: 'String',
    });
  }

  /**
   * Updates the nested stack props to include AssetsBucketName and AssetsBucketPrefix
   * parameters from the parent stack
   */
  private static updateBaseParams(scope: cdk.Stack, props?: cdk.NestedStackProps): cdk.NestedStackProps {
    const updatedProps = props ?? {};

    // Find the parameters in the parent stack
    const assetsBucketName = scope.node.findChild('AssetsBucketName') as cdk.CfnParameter;
    const assetsBucketPrefix = scope.node.findChild('AssetsBucketPrefix') as cdk.CfnParameter;

    // Add or update the parameters
    updatedProps.parameters = {
      ...updatedProps.parameters,
      AssetsBucketName: assetsBucketName.valueAsString,
      AssetsBucketPrefix: assetsBucketPrefix.valueAsString,
    };

    return updatedProps;
  }
}
