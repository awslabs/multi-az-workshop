// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Every file the build makes (`npx projen build:assets`, src/cdk/build-assets.ts) that the CDK app
 * or the guide reads, named once: the build writes these names and the constructs read them. No
 * imports, so the build script loads it without the CDK.
 */

/**
 * The container image tarballs and Helm charts CreEcrImport loads into ECR. Outside assets/: each
 * is a CDK asset, uploaded once as itself.
 */
export const ECR_IMPORT_DIR = 'dist/ecr-import';

/** Files the stack and the guide fetch by name under AssetsBucketPrefix (the whole directory is uploaded). */
export const ASSETS_DIR = 'assets';

/** Istio's charts, in install order, and its images (the distroless variant, `<version>-distroless`). */
export const ISTIO_CHARTS = ['base', 'istiod', 'cni'] as const;
export const ISTIO_IMAGES = ['pilot', 'proxyv2', 'install-cni'] as const;
export type IstioChart = typeof ISTIO_CHARTS[number];
export type IstioImage = typeof ISTIO_IMAGES[number];

/** The AWS Load Balancer Controller's chart, and its image's tag (the arm64 one). */
export const LB_CONTROLLER_CHART = 'aws-load-balancer-controller';
export const lbControllerImageTag = (version: string): string => `v${version}-linux_arm64`;

/** Names under ECR_IMPORT_DIR. A chart is named as `helm package` names it. */
export const ecrImportFiles = {
  chart: (name: string, version: string): string => `${name}-${version}.tgz`,
  istioImage: (name: IstioImage): string => `${name}.tar.gz`,
  lbControllerImage: 'aws-load-balancer-controller.tar.gz',
  /** Also in the CodeDeploy bundles, where src/app/docker/load-container.sh loads them by these names. */
  appImage: 'container.tar.gz',
  cloudwatchAgentImage: 'cloudwatch-agent.tar.gz',
} as const;

/** Names under ASSETS_DIR. */
export const assetFiles = {
  /** The guide's lab 2 downloads it (content/lab-2). */
  kubectl: 'kubectl',
  dockerCompose: 'docker-compose',
  /** The CodeDeploy bundles: the app and the failing app (built with FAIL defined). */
  appBundle: 'app_deploy.zip',
  failingAppBundle: 'app_deploy_fail.zip',
  /** The whole build, for the guide's "on your own" download. */
  content: 'content.zip',
} as const;

/** The local tags the EC2 fleet's docker-compose.yml runs (src/app/docker): the tarballs are saved with them. */
export const APP_LOCAL_IMAGE = 'multi-az-workshop:latest';
export const CLOUDWATCH_AGENT_LOCAL_IMAGE = 'cloudwatch-agent/cloudwatch-agent:latest';
