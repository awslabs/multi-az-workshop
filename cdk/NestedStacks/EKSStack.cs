// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Amazon.CDK;
using Amazon.CDK.AWS.EC2;
using Amazon.CDK.AWS.ElasticLoadBalancingV2;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.Lambda;
using Amazon.CDK.AWS.RDS;
using Constructs;
using Amazon.AWSLabs.MultiAZWorkshop.Constructs;
using Newtonsoft.Json;

#if NET8_0_OR_GREATER
using System.Formats.Tar;
using System.Net.Http;
using System.Threading.Tasks;
using System.IO.Compression;
#endif

namespace Amazon.AWSLabs.MultiAZWorkshop.NestedStacks
{
    public class EKSStackProps : NestedStackProps, IEKSStackProps
    {
        public IVpc Vpc {get; set;}

        public InstanceArchitecture CpuArch {get; set;} = InstanceArchitecture.ARM_64;

        public DatabaseCluster Database {get; set;}

        public ISecurityGroup LoadBalancerSecurityGroup {get; set;}

        public string IAMResourcePath {get; set;} = "/front-end/eks-fleet/";

        public string AdminRoleName {get; set;}
    }

    public interface IEKSStackProps : INestedStackProps
    {
        public IVpc Vpc {get; set;}

        public InstanceArchitecture CpuArch {get; set;}

        public DatabaseCluster Database {get; set;}

        public ISecurityGroup LoadBalancerSecurityGroup {get; set;}

        public string IAMResourcePath {get; set;}

        public string AdminRoleName {get; set;}
    }

    public class EKSStack : NestedStackWithSource
    {
        public IApplicationTargetGroup EKSAppTargetGroup {get;}
        
        public EKSStack(Stack scope, string id, IEKSStackProps props) : base(scope, id, props)
        { 
            Dictionary<string, string> versions = JsonConvert.DeserializeObject<Dictionary<string, string>>(File.ReadAllText("../build/versions.json"));

            //BuildHelmLayer().Wait(); // No available to do in .NET 6

            var repoHelmContainerCreator = new ContainerAndRepo(this, "container-and-repo-builder");

            EKSCluster cluster = new EKSCluster(this, "Cluster", new EKSClusterProps() {
                AdminRole = Role.FromRoleName(this, "AdminRole", props.AdminRoleName),
                CpuArch = props.CpuArch,
                DatabaseCluster = props.Database,
                Vpc = props.Vpc,
                LoadBalancerSecurityGroup = props.LoadBalancerSecurityGroup,
                ClusterName = "multi-az-workshop-eks-cluster",
                Version = versions["EKS"] 
            });

            this.FixUpNestedStacks();
        
            Istio istio = new Istio(this, "Istio", new IstioProps() {
                Cluster = cluster.Cluster,
                ContainerAndRepoBuilder = repoHelmContainerCreator,
                Version = versions["ISTIO"]
            });

            AwsLoadBalancerController lbController = new AwsLoadBalancerController(this, "AwsLoadBalancerController", new AwsLoadBalancerControllerProps() {
                Cluster = cluster.Cluster,
                ContainerAndRepoBuilder = repoHelmContainerCreator,
                ContainerVersion = versions["LB_CONTROLLER_CONTAINER"],
                HelmVersion = versions["LB_CONTROLLER_HELM"]
            });
            lbController.Node.AddDependency(istio.WaitableNode);

            EKSApplication app = new EKSApplication(this, "EKSApp", new EKSApplicationProps() {
                Cluster = cluster.Cluster,
                ContainerAndRepoBuilder = repoHelmContainerCreator,
                DatabaseCluster = props.Database,
                Namespace = "multi-az-workshop"
            });
            app.Node.AddDependency(istio);
            app.Node.AddDependency(lbController.WaitableNode);

            this.EKSAppTargetGroup = app.AppTargetGroup;
        }

        public void FixUpNestedStacks()
        {
            FixUpResourceProvider("@aws-cdk--aws-eks.ClusterResourceProvider");
            FixUpResourceProvider("@aws-cdk--aws-eks.KubectlProvider");

            FixUpLambdaFunctions("@aws-cdk--aws-eks.KubectlProvider");
        }

        private void FixUpLambdaFunctions(string name)
        {
            IConstruct resourceProviderNestedStack = this.Node.TryFindChild(name);

            if (resourceProviderNestedStack != null)
            {
                NestedStack nestedStack = resourceProviderNestedStack as NestedStack;

                if (nestedStack != null)
                {
                    Function lambda = nestedStack.Node.TryFindChild("Handler") as Function;

                    if (lambda != null)
                    {
                        lambda.AddEnvironment("AWS_STS_REGIONAL_ENDPOINTS", "regional");
                    }

                    IConstruct provider = nestedStack.Node.TryFindChild("Provider");
                    Function onEvent = provider.Node.TryFindChild("framework-onEvent") as Function;

                    if (onEvent != null)
                    {
                        onEvent.AddEnvironment("AWS_STS_REGIONAL_ENDPOINTS", "regional");
                    }
                }
            }
        }

        private void FixUpResourceProvider(string name)
        {
            IConstruct resourceProviderNestedStack = this.Node.TryFindChild(name);

            // Add the parameters to the actual nested stack so it can receive them
            if (resourceProviderNestedStack != null)
            {
                NestedStack nestedStack = resourceProviderNestedStack as NestedStack;

                if (nestedStack != null)
                {
                    nestedStack.Node.Children.Append(new CfnParameter(nestedStack, "AssetsBucketName", new CfnParameterProps() {
                        Type = "String"
                    }));

                    nestedStack.Node.Children.Append(new CfnParameter(nestedStack, "AssetsBucketPrefix", new CfnParameterProps() {
                        Type = "String"
                    }));
                }

                /*
                var nestedStackResource = nestedStack.NestedStackResource as CfnStack;

                if (nestedStackResource.Parameters == null || nestedStackResource.Parameters.GetType() == typeof(Amazon.JSII.Runtime.Deputy.AnonymousObject))
                {
                    Console.WriteLine("Writing new parameters");

                    nestedStackResource.Parameters = new Dictionary<string, string>() {
                        { "AssetsBucketName", Fn.Ref("AssetsBucketName")},
                        { "AssetsBucketPrefix", Fn.Ref("AssetsBucketPrefix")}
                    };
                }
                else {
                    Console.WriteLine("Adding to parameters");

                    (nestedStackResource.Parameters as Dictionary<string, string>).Add("AssetsBucketName", Fn.Ref("AssetsBucketName"));
                    (nestedStackResource.Parameters as Dictionary<string, string>).Add("AssetsBucketPrefix", Fn.Ref("AssetsBucketPrefix"));
                }
                */
            }
        }
    

        #if NET8_0_OR_GREATER
        private async Task BuildHelmLayer()
        {
            if (!File.Exists("helm-layer.zip"))
            {
                using (HttpClient client = new HttpClient())
                {
                    using (var stream = await client.GetStreamAsync("https://get.helm.sh/helm-v3.15.1-linux-arm64.tar.gz"))
                    {
                        using (var fs = new FileStream("helm.tar.gz", FileMode.OpenOrCreate))
                        {
                            stream.CopyTo(fs);
                        }
                    }
                }

                // Decompress the .gz file
                using (FileStream originalFileStream = File.OpenRead("helm.tar.gz"))
                {
                    using (FileStream decompressedFileStream = File.Create("helm.tar"))
                    {
                        using (GZipStream decompressionStream = new GZipStream(originalFileStream, CompressionMode.Decompress))
                        {
                            decompressionStream.CopyTo(decompressedFileStream);
                        }

                        decompressedFileStream.Seek(0, SeekOrigin.Begin);
                        Directory.CreateDirectory("helm-tar");
                        TarFile.ExtractToDirectory(decompressedFileStream, "helm-tar", true);
                    }
                }

                Directory.CreateDirectory("helm");
                File.Copy("helm-tar/linux-arm64/helm", "helm/helm");

                using (FileStream zipStream = File.Create("helm-layer.zip"))
                {
                    ZipFile.CreateFromDirectory("helm", zipStream, CompressionLevel.Optimal, true);
                }

                Directory.Delete("helm", true);
                Directory.Delete("helm-tar", true);
                File.Delete("helm.tar");
                File.Delete("helm.tar.gz");
            }
        }
        #endif
    }
}