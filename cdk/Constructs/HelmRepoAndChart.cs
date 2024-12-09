// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System.Collections.Generic;
using Amazon.CDK;
using Amazon.CDK.AWS.ECR;
using Amazon.CDK.AWS.Lambda;
using Constructs;

namespace Amazon.AWSLabs.MultiAZWorkshop.Constructs
{
    public abstract class HelmRepoAndChartConstruct : Construct
    {
        public HelmRepoAndChartConstruct(Construct scope, string id) : base(scope, id)
        {}

        public Repository CreateHelmRepoAndChart(string name, string version, IFunction function)
        {
            Repository repo = new Repository(this, name + "HelmRepo", new RepositoryProps() {
                EmptyOnDelete = true,
                RemovalPolicy = RemovalPolicy.DESTROY,
                RepositoryName = name
            });

            CustomResource chart = new CustomResource(this, name + "HelmChart", new CustomResourceProps() {
                ServiceToken = function.FunctionArn,
                Properties = new Dictionary<string, object> {
                    { "Type", "Helm" },
                    { "Bucket", Fn.Ref("AssetsBucket") },
                    { "Key", Fn.Ref("AssetsBucketPrefix") + "helm/" + name + "-" + version + ".tgz" },
                    { "Repository", repo.RepositoryName }
                }
            });

            return repo;
        }
    }

}