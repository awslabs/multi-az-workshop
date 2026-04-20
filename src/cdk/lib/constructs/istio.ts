// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as eks from 'aws-cdk-lib/aws-eks-v2';
import * as eks_legacy from 'aws-cdk-lib/aws-eks';
import * as iam from 'aws-cdk-lib/aws-iam';
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
   * @default "1.29.0"
   */
  readonly version?: string;

  /**
   * The role being provided admin access to istio resources
   * 
   * @default "No role is given access"
   */
  readonly role?: iam.IRole;
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

    const version = props.version ?? '1.29.0';

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
    props.containerAndRepoBuilder.addContainerAndRepo({
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
      '300',
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
      '300',
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

    if (props.role) {
      new eks_legacy.CfnAccessEntry(this, 'IstioAccessEntry', {
        clusterName: props.cluster.clusterName,
        principalArn: props.role.roleArn,
        type: eks_legacy.AccessEntryType.STANDARD,
        kubernetesGroups: ["istio-admins"]
      });

      const istioClusterRole = props.cluster.addManifest('IstioClusterRole', {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'ClusterRole',
        metadata: {
          name: 'istio-admin',
        },
        rules: [
          {
            apiGroups: ['networking.istio.io'],
            resources: ['*'],
            verbs: ['*'],
          },
          {
            apiGroups: ['security.istio.io'],
            resources: ['*'],
            verbs: ['*'],
          },
          {
            apiGroups: ['authentication.istio.io'],
            resources: ['*'],
            verbs: ['*'],
          },
        ],
      });

      const roleBinding = props.cluster.addManifest('IstioAdminsClusterRoleBinding', {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'ClusterRoleBinding',
        metadata: {
          name: 'istio-admins-binding',
        },
        subjects: [
          {
            kind: 'Group',
            name: "istio-admins",
            apiGroup: 'rbac.authorization.k8s.io',
          },
        ],
        roleRef: {
          kind: 'ClusterRole',
          name: 'istio-admin',
          apiGroup: 'rbac.authorization.k8s.io',
        },
      });

      roleBinding.node.addDependency(istioClusterRole);
    }
    
    this.waitableNode = cni;
  }
}
