// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System.Collections.Generic;
using Amazon.CDK;
using Amazon.CDK.AWS.EKS;
using Constructs;

namespace Amazon.AWSLabs.MultiAZWorkshop.Constructs
{
    public interface IIstioProps
    {
        public ICluster Cluster {get; set;}

        public ContainerAndRepo ContainerAndRepoBuilder {get; set;}

        public string Version {get; set;}
    }

    public class IstioProps : IIstioProps
    {
        public ICluster Cluster {get; set;}

        public ContainerAndRepo ContainerAndRepoBuilder {get; set;}

        public string Version {get; set;} = "1.24.1";
    }
    
    public class Istio : HelmRepoAndChartConstruct
    {
        public IDependable WaitableNode {get; }

        public Istio(Construct scope, string id, IIstioProps props) : base(scope, id)
        {
            var istioBaseHelmChartRepo = props.ContainerAndRepoBuilder.CreateRepoAndHelmChart(new RepoAndHelmChartProps() {
                HelmChartName = "base",
                Version = props.Version,
                RepositoryName = "base"
            });

            var istiodHelmChartRepo = props.ContainerAndRepoBuilder.CreateRepoAndHelmChart(new RepoAndHelmChartProps() {
                HelmChartName = "istiod",
                Version = props.Version,
                RepositoryName = "istiod"
            });

            /*var istioGatewayHelmChartRepo = props.ContainerAndRepoBuilder.CreateRepoAndHelmChart(new RepoAndHelmChartProps() {
                HelmChartName = "gateway",
                Version = props.Version,
                RepositoryName = "gateway"
            });*/

            var istioCniHelmChartRepo = props.ContainerAndRepoBuilder.CreateRepoAndHelmChart(new RepoAndHelmChartProps() {
                HelmChartName = "cni",
                Version = props.Version,
                RepositoryName = "cni"
            });

            // Used by the istiod helm chart
            var cniContainer = props.ContainerAndRepoBuilder.AddContainerAndRepo(new RepoAndContainerProps() {
                ContainerImageS3ObjectKey = "pilot.tar.gz",
                RepositoryName = "istio/pilot"
            });

            // Used by istio as a sidecar
            var proxyContainer = props.ContainerAndRepoBuilder.AddContainerAndRepo(new RepoAndContainerProps() {
                ContainerImageS3ObjectKey = "proxyv2.tar.gz",
                RepositoryName = "istio/proxyv2"
            });

            // Used by the CNI helm chart
            var installCniContainer = props.ContainerAndRepoBuilder.AddContainerAndRepo(new RepoAndContainerProps() {
                ContainerImageS3ObjectKey = "install-cni.tar.gz",
                RepositoryName = "istio/install-cni"
            });

            // No image required
            HelmChart baseChart = props.Cluster.AddHelmChart("IstioBaseHelmChart", new HelmChartOptions() {
                Chart = "base",
                Version = props.Version,
                Repository = "oci://" + istioBaseHelmChartRepo.Repository.RepositoryUri,
                Namespace = "istio-system",
                Wait = true
            });
            baseChart.Node.AddDependency(istioBaseHelmChartRepo.Dependable);
            ((baseChart.Node.FindChild("Resource") as CustomResource).Node.DefaultChild as CfnResource).AddPropertyOverride("ServiceTimeout", "300");

            // Starting with istio version 1.24.0, the helm chart is configured to fail
            // if "defaults" is set

            // Uses the pilot container image
            HelmChart istiod = props.Cluster.AddHelmChart("Istiod", new HelmChartOptions() {
                Chart = "istiod",
                Version = props.Version,
                Repository = "oci://" + istiodHelmChartRepo.Repository.RepositoryUri,
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
            istiod.Node.AddDependency(cniContainer.Dependable);
            istiod.Node.AddDependency(istiodHelmChartRepo.Dependable);
            ((istiod.Node.FindChild("Resource") as CustomResource).Node.DefaultChild as CfnResource).AddPropertyOverride("ServiceTimeout", "300");

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
                Repository = "oci://" + istioCniHelmChartRepo.Repository.RepositoryUri,
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
            cni.Node.AddDependency(installCniContainer.Dependable);
            cni.Node.AddDependency(istioCniHelmChartRepo.Dependable);
            ((cni.Node.FindChild("Resource") as CustomResource).Node.DefaultChild as CfnResource).AddPropertyOverride("ServiceTimeout", "300");

            this.WaitableNode = cni;
        }
    }
}