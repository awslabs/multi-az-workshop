// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System.Collections.Generic;
using Amazon.CDK;

namespace Amazon.AWSLabs.MultiAZWorkshop.Constructs
{
    public class NestedStackWithSource : NestedStack
    {
        public CfnParameter AssetsBucketName {get;}

        public CfnParameter AssetsBucketPrefix {get;}

        public NestedStackWithSource(Stack scope, string id, INestedStackProps props = null) : base(scope, id, UpdateBaseParams(scope, props))
        {
            // This creates the parameters in the nested stack, but does
            // not yet assign them calues from the parent stack
            this.AssetsBucketName = new CfnParameter(this, "AssetsBucketName", new CfnParameterProps() {
                MinLength = 1,
                Type = "String"
            });
            this.AssetsBucketPrefix = new CfnParameter(this, "AssetsBucketPrefix", new CfnParameterProps() {
                Type = "String"
            });
        }

        // This finds the parent stack and gets its values for the two
        // parameters and assigns them to the parameters passed to the nested
        // stack construct
        private static INestedStackProps UpdateBaseParams(Stack scope, INestedStackProps props)
        {
            if (props == null)
            {
                props = new NestedStackProps();
            }

            CfnParameter assetsBucketName = scope.Node.FindChild("AssetsBucketName") as CfnParameter;
            CfnParameter assetsBucketPrefix = scope.Node.FindChild("AssetsBucketPrefix") as CfnParameter;

            if (props.Parameters == null)
            {
                NestedStackProps tmp = props as NestedStackProps;
                tmp.Parameters = new Dictionary<string, string>() {
                    {"AssetsBucketName", assetsBucketName.ValueAsString},
                    {"AssetsBucketPrefix", assetsBucketPrefix.ValueAsString}
                };
                props = tmp;
            }
            else
            {
                props.Parameters.TryAdd("AssetsBucketName", assetsBucketName.ValueAsString);
                props.Parameters.TryAdd("AssetsBucketPrefix", assetsBucketPrefix.ValueAsString);
            }

            return props as INestedStackProps;
        }
    }
}