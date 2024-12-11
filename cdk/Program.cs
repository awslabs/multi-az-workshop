// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using Amazon.CDK;

namespace Amazon.AWSLabs.MultiAZWorkshop
{
    sealed class Program
    {
        public static void Main(string[] args)
        {           
            var app = new App();

            MultiAZWorkshopStack multiAZWorkshop = new MultiAZWorkshopStack(app, "multi-az-workshop", new StackProps(){
                StackName = "multi-az-workshop",
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
