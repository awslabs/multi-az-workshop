// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using Amazon.CDK;
using Amazon.CDK.AWS.CodePipeline;
using Constructs;

namespace Amazon.AWSLabs.MultiAZWorkshopPipeline
{
    public class MultiAZWorkshopPipeline : Stack
    {
        public MultiAZWorkshopPipeline(Construct scope, string id, IStackProps props) : base(scope, id)
        {
            Pipeline pipeline = new Pipeline(this, "pipeline", new PipelineProps() {
            });
        }
    }
}