// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System.Collections.Generic;
using Amazon.CDK;
using Amazon.CDK.AWS.CodeBuild;
using Amazon.CDK.AWS.ECR;
using Amazon.CDK.AWS.EKS;
using Amazon.CDK.AWS.Lambda;
using Constructs;

namespace Amazon.AWSLabs.MultiAZWorkshop.Constructs
{
    public interface IIstioProps
    {
        public ICluster Cluster {get; set;}

        public IFunction UploaderFunction {get; set;}

        public IProject ContainerBuildProject {get; set;}

        public string Version {get; set;}
    }

    public class IstioProps : IIstioProps
    {
        public ICluster Cluster {get; set;}

        public IFunction UploaderFunction {get; set;}

        public IProject ContainerBuildProject {get; set;}

        public string Version {get; set;} = "1.24.1";
    }
    
    public class Istio : HelmRepoAndChartConstruct
    {
        public IDependable WaitableNode {get; }

        public Istio(Construct scope, string id, IIstioProps props) : base(scope, id)
        {
            var istioBaseHelmChartRepo = CreateHelmRepoAndChart("base", props.Version, props.UploaderFunction);

            var istiodHelmChartRepo = CreateHelmRepoAndChart("istiod", props.Version, props.UploaderFunction);

            //var istioGatewayHelmChartRepo = CreateHelmRepoAndChart("gateway", uploader);

            var istioCniHelmChartRepo = CreateHelmRepoAndChart("cni", props.Version, props.UploaderFunction);

            // Used by the istiod helm chart
            Repository cniPilotContainerImageRepo = new Repository(this, "CniPilotContainerImageRepo", new RepositoryProps() {
                EmptyOnDelete = true,
                RemovalPolicy = RemovalPolicy.DESTROY,
                RepositoryName = "istio/pilot"
            });
            CustomResource cniPilotContainerImage = new CustomResource(this, "PilotContainer", new CustomResourceProps() {
                ServiceToken = props.UploaderFunction.FunctionArn,
                Properties = new Dictionary<string, object> {
                    { "Type", "Docker" },
                    { "Bucket", Fn.Ref("AssetsBucketName") },
                    { "Key", Fn.Ref("AssetsBucketPrefix") + "pilot.tar.gz" },
                    { "ProjectName", props.ContainerBuildProject.ProjectName },
                    { "Repository", cniPilotContainerImageRepo.RepositoryName }
                }
            });

            // Used by the istio gateway helm chart
            Repository proxyContainerImageRepo = new Repository(this, "ProxyContainerImageRepo", new RepositoryProps() {
                EmptyOnDelete = true,
                RemovalPolicy = RemovalPolicy.DESTROY,
                RepositoryName = "istio/proxyv2"
            });
            CustomResource proxyContainerImage = new CustomResource(this, "ProxyContainer", new CustomResourceProps() {
                ServiceToken = props.UploaderFunction.FunctionArn,
                Properties = new Dictionary<string, object> {
                    { "Type", "Docker" },
                    { "Bucket", Fn.Ref("AssetsBucketName") },
                    { "Key", Fn.Ref("AssetsBucketPrefix") + "proxyv2.tar.gz" },
                    { "ProjectName", props.ContainerBuildProject.ProjectName },
                    { "Repository", proxyContainerImageRepo.RepositoryName }
                }
            });

            // Used by the CNI helm chart
            Repository cniInstallContainerImageRepo = new Repository(this, "CniInstallContainerImageRepo", new RepositoryProps() {
                EmptyOnDelete = true,
                RemovalPolicy = RemovalPolicy.DESTROY,
                RepositoryName = "istio/install-cni"
            });
            CustomResource installCniContainerImage = new CustomResource(this, "InstallCNIContainer", new CustomResourceProps() {
                ServiceToken = props.UploaderFunction.FunctionArn,
                Properties = new Dictionary<string, object> {
                    { "Type", "Docker" },
                    { "Bucket", Fn.Ref("AssetsBucketName") },
                    { "Key", Fn.Ref("AssetsBucketPrefix") + "install-cni.tar.gz" },
                    { "ProjectName", props.ContainerBuildProject.ProjectName },
                    { "Repository", cniInstallContainerImageRepo.RepositoryName }
                }
            });

            // No image required
            HelmChart baseChart = props.Cluster.AddHelmChart("IstioBaseHelmChart", new HelmChartOptions() {
                Chart = "base",
                Version = props.Version,
                Repository = "oci://" + istioBaseHelmChartRepo.RepositoryUri,
                Namespace = "istio-system",
                Wait = true
            });

            // Starting with istio version 1.24.0, the helm chart is configured to fail
            // if "defaults" is set

            // Uses the pilot container image
            HelmChart istiod = props.Cluster.AddHelmChart("Istiod", new HelmChartOptions() {
                Chart = "istiod",
                Version = props.Version,
                Repository = "oci://" + istiodHelmChartRepo.RepositoryUri,
                Namespace = "istio-system",
                Wait = true,
                Values = new Dictionary<string, object>() {
                    //{"defaults", new Dictionary<string, object>() {
                        {"global", new Dictionary<string, object>() {
                            {"hub", Fn.Sub("${AWS::AccountId}.dkr.ecr.${AWS::Region}.${AWS::URLSuffix}/istio") }
                        }}
                    //}}
                }
            });

            istiod.Node.AddDependency(baseChart);
            istiod.Node.AddDependency(cniPilotContainerImage);

            // Proxy image used
            /*
            HelmChart gateway = eksCluster.AddHelmChart("IstioGateway", new HelmChartOptions() {
                Chart = "gateway",
                Version = props.Version,
                Repository = "oci://" + istioGatewayHelmChartRepo.RepositoryUri,
                Namespace = "istio-system",
                Values = new Dictionary<string, object>() {
                    //{"defaults", new Dictionary<string, object>() {
                        {"service", new Dictionary<string, object>() {
                            { "type", "NodePort" }
                        }}
                    //}}
                }
            });

            gateway.Node.AddDependency(istiod);
            gateway.Node.AddDependency(proxyContainerImage);
            */

            // Uses the install-cni image
            HelmChart cni = props.Cluster.AddHelmChart("IstioCNI", new HelmChartOptions() {
                Chart = "cni",
                Version = props.Version,
                Repository = "oci://" + istioCniHelmChartRepo.RepositoryUri,
                Namespace = "istio-system",
                Wait = true,
                Values = new Dictionary<string, object>() {
                    //{"defaults", new Dictionary<string, object>() {
                        {"global", new Dictionary<string, object>() {
                            {"hub", Fn.Sub("${AWS::AccountId}.dkr.ecr.${AWS::Region}.${AWS::URLSuffix}/istio") }
                        }}
                    //}}
                }
            });

            cni.Node.AddDependency(istiod);   
            cni.Node.AddDependency(installCniContainerImage);

            this.WaitableNode = cni;
        }
    }
}