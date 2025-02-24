// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using Amazon.CDK;

namespace Amazon.AWSLabs.MultiAZWorkshopPipeline
{
    sealed class Program
    {
        public static void Main(string[] args)
        {           
            var app = new App();

            MultiAZWorkshopPipeline pipeline = new MultiAZWorkshopPipeline(app, "multi-az-workshop-pipeline", new StackProps(){
                StackName = "multi-az-workshop-pipeline",
                Env = new Amazon.CDK.Environment() {
                    Region = Aws.REGION
                },
                Synthesizer = new DefaultStackSynthesizer(new DefaultStackSynthesizerProps() {
                    FileAssetsBucketName = "${AssetsBucketName}",
                    BucketPrefix = "${AssetsBucketPrefix}",
                    Qualifier = null,
                    GenerateBootstrapVersionRule = false              
                })
            });
                     
            app.Synth();
        }
    }
}
