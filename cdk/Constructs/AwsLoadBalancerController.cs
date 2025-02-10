// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using Amazon.CDK;
using Amazon.CDK.AWS.EKS;
using Amazon.CDK.AWS.IAM;
using Constructs;
using Newtonsoft.Json;

namespace Amazon.AWSLabs.MultiAZWorkshop.Constructs
{
    public interface IAwsLoadBalancerControllerProps
    {
        public ICluster Cluster {get; set;}
        public ContainerAndRepo ContainerAndRepoBuilder {get; set;}
        public string ContainerVersion {get; set;}
        public string HelmVersion {get; set;}
    }

    public class AwsLoadBalancerControllerProps : IAwsLoadBalancerControllerProps
    {
        public ICluster Cluster {get; set;}
        public ContainerAndRepo ContainerAndRepoBuilder {get; set;}
        public string ContainerVersion {get; set;} = "v2.8.1";
        public string HelmVersion {get; set;} = "1.10.1";
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

            ManagedPolicy loadBalancerControllerManagedPolicy = Task.Run(() => this.CreateAwsLoadBalancerControllerIAMPolicy(props.ContainerVersion)).Result;
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

            var loadBalancerControllerHelmChartRepo = props.ContainerAndRepoBuilder.CreateRepoAndHelmChart(new RepoAndHelmChartProps() {
                HelmChartName = "aws-load-balancer-controller",
                Version = props.HelmVersion,
                RepositoryName = "aws-load-balancer-controller"
            });

            // Used by the aws-load-balancer-controller helm chart
            var awsLB = props.ContainerAndRepoBuilder.AddContainerAndRepo(new RepoAndContainerProps() {
                ContainerImageS3ObjectKey = "aws-load-balancer-controller.tar.gz",
                RepositoryName = "eks/aws-load-balancer-controller"
            });

            // Uses the aws-load-balancer-controller image
            HelmChart loadBalancerController = props.Cluster.AddHelmChart("AwsLoadBalancerController", new HelmChartOptions() {
                Chart = "aws-load-balancer-controller",
                Repository = "oci://" + loadBalancerControllerHelmChartRepo.Repository.RepositoryUri,
                Namespace = "kube-system",
                Wait = true,
                Version = props.HelmVersion,
                Values = new Dictionary<string, object>() {
                    {"clusterName", props.Cluster.ClusterName },
                    {"image", new Dictionary<string, object>() {
                        {"repository", Fn.Sub("${AWS::AccountId}.dkr.ecr.${AWS::Region}.${AWS::URLSuffix}/eks/aws-load-balancer-controller")},
                        {"tag", props.ContainerVersion + "-linux_arm64"}
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
            loadBalancerController.Node.AddDependency(awsLB.Dependable);
            loadBalancerController.Node.AddDependency(loadBalancerControllerManagedPolicy);
            loadBalancerController.Node.AddDependency(loadBalancerControllerHelmChartRepo.Dependable);

            this.WaitableNode = loadBalancerController;
        }

        private async Task<ManagedPolicy> CreateAwsLoadBalancerControllerIAMPolicy(string version)
        {
            using (HttpClient client = new HttpClient())
            {
                using (Stream stream = await client.GetStreamAsync($"https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/{version}/docs/install/iam_policy.json"))
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