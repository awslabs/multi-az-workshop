// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as eks from 'aws-cdk-lib/aws-eks';
import { Construct, IDependable } from 'constructs';
import { ContainerAndRepo, RepoAndHelmChartProps, RepoAndContainerProps } from './container-and-repo';
import { HelmRepoAndChartConstruct } from './helm-repo-and-chart';

/**
 * Properties for Istio construct
 */
export interface IstioProps {
  /**
   * The EKS cluster to install Istio on
   */
  readonly cluster: eks.ICluster;

  /**
   * Container and repository builder for managing container images and Helm charts
   */
  readonly containerAndRepoBuilder: ContainerAndRepo;

  /**
   * Istio version to install
   * @default "1.24.1"
   */
  readonly version?: string;
}

/**
 * Construct that installs Istio service mesh on an EKS cluster
 */
export class Istio extends HelmRepoAndChartConstruct {
  /**
   * Waitable node for dependency management
   */
  public readonly waitableNode: IDependable;

  constructor(scope: Construct, id: string, props: IstioProps) {
    super(scope, id);

    const version = props.version ?? '1.24.1';

    // Create Helm chart repositories
    const istioBaseHelmChartRepo = props.containerAndRepoBuilder.createRepoAndHelmChart({
      helmChartName: 'base',
      version: version,
      repositoryName: 'base',
    } as RepoAndHelmChartProps);

    const istiodHelmChartRepo = props.containerAndRepoBuilder.createRepoAndHelmChart({
      helmChartName: 'istiod',
      version: version,
      repositoryName: 'istiod',
    } as RepoAndHelmChartProps);

    const istioCniHelmChartRepo = props.containerAndRepoBuilder.createRepoAndHelmChart({
      helmChartName: 'cni',
      version: version,
      repositoryName: 'cni',
    } as RepoAndHelmChartProps);

    // Create container repositories
    // Used by the istiod helm chart
    const cniContainer = props.containerAndRepoBuilder.addContainerAndRepo({
      containerImageS3ObjectKey: 'pilot.tar.gz',
      repositoryName: 'istio/pilot',
    } as RepoAndContainerProps);

    // Used by istio as a sidecar
    const proxyContainer = props.containerAndRepoBuilder.addContainerAndRepo({
      containerImageS3ObjectKey: 'proxyv2.tar.gz',
      repositoryName: 'istio/proxyv2',
    } as RepoAndContainerProps);

    // Used by the CNI helm chart
    const installCniContainer = props.containerAndRepoBuilder.addContainerAndRepo({
      containerImageS3ObjectKey: 'install-cni.tar.gz',
      repositoryName: 'istio/install-cni',
    } as RepoAndContainerProps);

    // Install Istio base chart (no image required)
    const baseChart = props.cluster.addHelmChart('IstioBaseHelmChart', {
      chart: 'base',
      version: version,
      repository: 'oci://' + istioBaseHelmChartRepo.repository.repositoryUri,
      namespace: 'istio-system',
      wait: true,
    });
    baseChart.node.addDependency(istioBaseHelmChartRepo.dependable);
    (baseChart.node.findChild('Resource').node.defaultChild as cdk.CfnResource).addPropertyOverride(
      'ServiceTimeout',
      '300'
    );

    // Install Istiod (uses the pilot container image)
    // Starting with istio version 1.24.0, the helm chart is configured to fail
    // if "defaults" is set
    const istiod = props.cluster.addHelmChart('Istiod', {
      chart: 'istiod',
      version: version,
      repository: 'oci://' + istiodHelmChartRepo.repository.repositoryUri,
      namespace: 'istio-system',
      wait: true,
      values: {
        global: {
          hub: cdk.Fn.sub('${AWS::AccountId}.dkr.ecr.${AWS::Region}.${AWS::URLSuffix}/istio'),
        },
      },
    });

    istiod.node.addDependency(baseChart);
    istiod.node.addDependency(cniContainer.dependable);
    istiod.node.addDependency(istiodHelmChartRepo.dependable);
    (istiod.node.findChild('Resource').node.defaultChild as cdk.CfnResource).addPropertyOverride(
      'ServiceTimeout',
      '300'
    );

    // Install Istio CNI (uses the install-cni image)
    const cni = props.cluster.addHelmChart('IstioCNI', {
      chart: 'cni',
      version: version,
      repository: 'oci://' + istioCniHelmChartRepo.repository.repositoryUri,
      namespace: 'istio-system',
      wait: true,
      values: {
        global: {
          hub: cdk.Fn.sub('${AWS::AccountId}.dkr.ecr.${AWS::Region}.${AWS::URLSuffix}/istio'),
        },
      },
    });

    cni.node.addDependency(istiod);
    cni.node.addDependency(installCniContainer.dependable);
    cni.node.addDependency(istioCniHelmChartRepo.dependable);
    (cni.node.findChild('Resource').node.defaultChild as cdk.CfnResource).addPropertyOverride('ServiceTimeout', '300');

    this.waitableNode = cni;
  }
}
