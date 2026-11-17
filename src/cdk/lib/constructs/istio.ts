// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as eks from 'aws-cdk-lib/aws-eks-v2';
import { Construct, IDependable } from 'constructs';
import { CreEcrImport } from '@cre/constructs';
import { builtAsset } from '../build-assets';

/**
 * Properties for Istio construct
 */
export interface IstioProps {
  /**
   * The EKS cluster to install Istio on
   */
  readonly cluster: eks.ICluster;

  /**
   * Loads the Istio charts and images (S3 assets the build makes) into ECR
   */
  readonly ecrImport: CreEcrImport;

  /**
   * Istio version to install (build/versions.json ISTIO)
   */
  readonly version: string;

  /**
   * If you have created an access entry, provide the istio admins group name to
   * give access to that group
   * 
   * @default "No cluster role is created and no binding is made to the group"
   */
  readonly adminsGroupName?: string;
}

/**
 * Construct that installs Istio service mesh on an EKS cluster
 */
export class Istio extends Construct {
  /**
   * Waitable node for dependency management
   */
  public readonly waitableNode: IDependable;

  constructor(scope: Construct, id: string, props: IstioProps) {
    super(scope, id);

    const version = props.version;

    // The charts and images, loaded into ECR from the build's tarballs (build:assets).
    const chart = (name: string) => props.ecrImport.addHelmChart(`istio-${name}-chart`, {
      chart: builtAsset(this, `${name}-chart-asset`, `${name}-${version}.tgz`),
      name,
      version,
    });
    const image = (name: string) => props.ecrImport.addImage(`istio-${name}-image`, {
      tarball: builtAsset(this, `${name}-image-asset`, `${name}.tar.gz`),
      repositoryName: `istio/${name}`,
      // The distroless variant (global.variant below).
      tag: `${version}-distroless`,
    });
    const istioBaseHelmChartRepo = chart('base');
    const istiodHelmChartRepo = chart('istiod');
    const istioCniHelmChartRepo = chart('cni');

    // Used by the istiod helm chart
    const cniContainer = image('pilot');
    // Used by istio as a sidecar
    const proxyContainer = image('proxyv2');
    // Used by the CNI helm chart
    const installCniContainer = image('install-cni');

    // Install Istio base chart (no image required)
    const baseChart = props.cluster.addHelmChart('IstioBaseHelmChart', {
      chart: 'base',
      version: version,
      repository: istioBaseHelmChartRepo.uri,
      namespace: 'istio-system',
      wait: true,
    });
    baseChart.node.addDependency(istioBaseHelmChartRepo.ready);
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
      repository: istiodHelmChartRepo.uri,
      namespace: 'istio-system',
      wait: true,
      values: {
        global: {
          hub: cdk.Fn.sub('${AWS::AccountId}.dkr.ecr.${AWS::Region}.${AWS::URLSuffix}/istio'),
          // The distroless images (assets:istio-containers pulls <version>-distroless).
          variant: 'distroless',
        },
      },
    });

    istiod.node.addDependency(baseChart);
    istiod.node.addDependency(cniContainer.ready);
    // istiod injects the proxy into the app's pods, which then pull it.
    istiod.node.addDependency(proxyContainer.ready);
    istiod.node.addDependency(istiodHelmChartRepo.ready);
    (istiod.node.findChild('Resource').node.defaultChild as cdk.CfnResource).addPropertyOverride(
      'ServiceTimeout',
      '300',
    );

    // Install Istio CNI (uses the install-cni image)
    const cni = props.cluster.addHelmChart('IstioCNI', {
      chart: 'cni',
      version: version,
      repository: istioCniHelmChartRepo.uri,
      namespace: 'istio-system',
      wait: true,
      values: {
        global: {
          hub: cdk.Fn.sub('${AWS::AccountId}.dkr.ecr.${AWS::Region}.${AWS::URLSuffix}/istio'),
          // The distroless images (assets:istio-containers pulls <version>-distroless).
          variant: 'distroless',
        },
      },
    });

    cni.node.addDependency(istiod);
    cni.node.addDependency(installCniContainer.ready);
    cni.node.addDependency(istioCniHelmChartRepo.ready);
    (cni.node.findChild('Resource').node.defaultChild as cdk.CfnResource).addPropertyOverride('ServiceTimeout', '300');

    if (props.adminsGroupName) {

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
            name: props.adminsGroupName,
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
