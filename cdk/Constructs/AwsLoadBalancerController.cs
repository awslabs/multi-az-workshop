// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using Amazon.CDK;
using Amazon.CDK.AWS.CodeBuild;
using Amazon.CDK.AWS.ECR;
using Amazon.CDK.AWS.EKS;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.Lambda;
using Constructs;
using Newtonsoft.Json;

namespace Amazon.AWSLabs.MultiAZWorkshop.Constructs
{
    public interface IAwsLoadBalancerControllerProps
    {
        public ICluster Cluster {get; set;}
        public IFunction UploaderFunction {get; set;}
        public IProject ContainerBuildProject {get; set;}
    }

    public class AwsLoadBalancerControllerProps : IAwsLoadBalancerControllerProps
    {
        public ICluster Cluster {get; set;}
        public IFunction UploaderFunction {get; set;}
        public IProject ContainerBuildProject {get; set;}
    }

    public class AwsLoadBalancerController : HelmRepoAndChartConstruct
    {
        public IDependable WaitableNode {get;}

        public AwsLoadBalancerController(Construct scope, string id, IAwsLoadBalancerControllerProps props) : base(scope, id)
        {
            Role lbControllerRole = new Role(this, "AwsLoadBalancerControllerRole", new RoleProps() {
                Description = "The IAM role used by the load balancer controller",
                AssumedBy = new ServicePrincipal("pods.eks.amazonaws.com").WithSessionTags()
            });

            ManagedPolicy loadBalancerControllerManagedPolicy = Task.Run(() => this.CreateAwsLoadBalancerControllerIAMPolicy()).Result;
            lbControllerRole.AddManagedPolicy(loadBalancerControllerManagedPolicy);

            KubernetesManifest loadBalancerServiceAccount = new KubernetesManifest(this, "LoadBalancerServiceAccount", new KubernetesManifestProps() {
                Cluster = props.Cluster,
                Manifest = new Dictionary<string, object>[] {
                    new Dictionary<string, object>() {
                        {"apiVersion", "v1"},
                        {"kind", "ServiceAccount"},
                        {"metadata", new Dictionary<string, object>() {
                            {"name", "aws-load-balancer-controller"},
                            {"namespace", "kube-system"}
                        }}
                    }
                }
            }); 

            CfnPodIdentityAssociation loadBalancerContollerPodIdentityAssociation = new CfnPodIdentityAssociation(this, "AwsLoadBalancerControllerPodIdentityAssociation", new CfnPodIdentityAssociationProps() {
                ClusterName = props.Cluster.ClusterName,
                Namespace = "kube-system",
                ServiceAccount = "aws-load-balancer-controller",
                RoleArn = lbControllerRole.RoleArn
            });

            loadBalancerContollerPodIdentityAssociation.Node.AddDependency(loadBalancerServiceAccount);

            var loadBalancerControllerHelmChartRepo = CreateHelmRepoAndChart("aws-load-balancer-controller", "1.8.1", props.UploaderFunction);

            // Used by the aws-load-balancer-controller helm chart
            Repository loadBalancerControllerContainerImageRepo = new Repository(this, "LoadBalancerControllerContainerImageRepo", new RepositoryProps() {
                EmptyOnDelete = true,
                RemovalPolicy = RemovalPolicy.DESTROY,
                RepositoryName = "eks/aws-load-balancer-controller"
            });
            CustomResource loadBalancerControllerContainerImage = new CustomResource(this, "AWSLoadBalancerControllerContainer", new CustomResourceProps() {
                ServiceToken = props.UploaderFunction.FunctionArn,
                Properties = new Dictionary<string, object> {
                    { "Type", "Docker" },
                    { "Bucket", Fn.Ref("AssetsBucket") },
                    { "Key", Fn.Ref("AssetsBucketPrefix") + "helm/aws-load-balancer-controller.tar.gz" },
                    { "ProjectName", props.ContainerBuildProject.ProjectName },
                    { "Repository", loadBalancerControllerContainerImageRepo.RepositoryName }
                }
            });

            // Uses the aws-load-balancer-controller image
            HelmChart loadBalancerController = props.Cluster.AddHelmChart("AwsLoadBalancerController", new HelmChartOptions() {
                Chart = "aws-load-balancer-controller",
                Version = "1.8.1",
                Repository = "oci://" + loadBalancerControllerHelmChartRepo.RepositoryUri,
                Namespace = "kube-system",
                Wait = true,
                Values = new Dictionary<string, object>() {
                    {"clusterName", props.Cluster.ClusterName },
                    { "image", new Dictionary<string, object>() {
                        {"repository", Fn.Sub("${AWS::AccountId}.dkr.ecr.${AWS::Region}.${AWS::URLSuffix}/eks/aws-load-balancer-controller")},
                        {"tag", "v2.8.1-linux_arm64"}
                    }},
                    {"enableCertManager", false},
                    {"replicaCount", 1},
                    //{"region", Fn.Ref("AWS::Region")},
                    //{"vpcId", vpc.VpcId},
                    {"serviceAccount", new Dictionary<string, object>() {
                        {"create", false},
                        {"name", "aws-load-balancer-controller"}
                    }}
                }
            });

            loadBalancerController.Node.AddDependency(loadBalancerContollerPodIdentityAssociation);
            loadBalancerController.Node.AddDependency(loadBalancerControllerContainerImage);
            loadBalancerController.Node.AddDependency(loadBalancerControllerManagedPolicy);

            this.WaitableNode = loadBalancerController;
        }

        private async Task<ManagedPolicy> CreateAwsLoadBalancerControllerIAMPolicy()
        {
            using (HttpClient client = new HttpClient())
            {
                using (Stream stream = await client.GetStreamAsync("https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v2.8.1/docs/install/iam_policy.json"))
                {
                    using (StreamReader reader = new StreamReader(stream))
                    {
                        string data = reader.ReadToEnd();
                        
                        PolicyDocument doc = PolicyDocument.FromJson(JsonConvert.DeserializeObject<Dictionary<string, object>>(data));

                        return new ManagedPolicy(this, "AwsLoadBalancerContollerManagedPolicy", new ManagedPolicyProps(){
                            Document = doc
                        });
                    }
                }
            }       
        }
    }
}