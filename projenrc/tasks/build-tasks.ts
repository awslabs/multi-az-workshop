// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { TaskShell } from 'projen';
import { AwsCdkTypeScriptApp } from 'projen/lib/awscdk';
import { Task } from 'projen/lib/task';
import { CURL_RETRY, curlRetry } from '../cre/src';

/**
 * Where the asset tasks write the container image tarballs and Helm charts CreEcrImport loads into
 * ECR (src/cdk/lib/build-assets.ts ECR_IMPORT_DIR). Each is a CDK asset, so it stays out of
 * assets/, which holds the files the stack and the guide fetch by name under AssetsBucketPrefix.
 */
export const ECR_IMPORT_DIR = 'dist/ecr-import';

/** The versions in build/versions.json as shell variables (ISTIO, ISTIO_REPO, ...). */
const LOAD_VERSIONS = 'eval "$(node build/load-versions.js)"';

// kubectl and docker compose are 50-60 MB: CURL_RETRY's 300 s cap fails them below ~200 KB/s.
const LARGE_DOWNLOAD = curlRetry(1800);

// These tasks use eval, for loops and [ ]: bash, not projen's built-in shell.
const BASH = TaskShell.bash();

/**
 * Creates .NET application build tasks
 * @param project The AwsCdkTypeScriptApp project instance
 */
function createDotnetBuildTasks(project: AwsCdkTypeScriptApp): Task {
  return project.addTask('build:app', {
    description: 'Build .NET application',
    shell: BASH,
    steps: [
      { exec: 'rm -rf src/app/output' },
      { exec: 'mkdir -p src/app/output/src' },
      {
        exec: 'dotnet publish src/app/multi-az-workshop-application.csproj --configuration Release --runtime linux-musl-arm64 --output src/app/output/src -p:PublishReadyToRun=true -p:PublishReadyToRunShowWarnings=true --self-contained',
      },
    ],
  });
}

/**
 * Creates .NET test tasks
 * @param project The AwsCdkTypeScriptApp project instance
 */
function createDotnetTestTasks(project: AwsCdkTypeScriptApp): { unit: Task; integration: Task } {
  const env = {
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_ACCESS_KEY_ID: 'fake',
    AWS_SECRET_ACCESS_KEY: 'fake',
    AWS_DEFAULT_REGION: 'us-east-1',
  };
  const unit = project.addTask('test:app:unit', {
    description: 'Run .NET unit tests',
    env,
    exec: 'dotnet test test/app --filter "FullyQualifiedName!~Integration" --configuration Release --logger "console;verbosity=detailed"',
  });
  const integration = project.addTask('test:app:integration', {
    description: 'Run .NET integration tests',
    env,
    exec: 'dotnet test test/app --filter "FullyQualifiedName~Integration" --configuration Release --logger "console;verbosity=detailed"',
  });
  return { unit, integration };
}

/** Builds the app's container image (with `FAIL` defined: the failing build) and saves it to `out`. */
function containerBuildSteps(out: string, failing: boolean): { exec: string }[] {
  const constants = failing ? '-p:DefineConstants="FAIL" ' : '';
  return [
    { exec: 'rm -rf src/app/output' },
    { exec: 'mkdir -p src/app/output/src' },
    {
      exec: `cd src/app && dotnet publish --configuration Release --runtime linux-musl-arm64 --output output/src ${constants}-p:PublishReadyToRun=true -p:PublishReadyToRunShowWarnings=true --self-contained`,
    },
    {
      // The base image through the retrying pull first: docker build reads it from the local store
      // then, instead of fetching it once with no retry (a single network timeout failed a deploy).
      exec: `${LOAD_VERSIONS} && build/docker-pull-with-retry.sh --platform linux/arm64 $ALPINE_IMAGE:$ALPINE && docker build --tag $PROJECT_NAME:latest --platform linux/arm64 --build-arg SRC=src --build-arg BASE=$ALPINE_IMAGE:$ALPINE --file build/dockerfile src/app/output`,
    },
    { exec: `docker save $PROJECT_NAME:latest | gzip > ${out}` },
  ];
}

/** The CodeDeploy bundle the EC2 fleet installs: the app and CloudWatch agent images, and src/app/docker. */
function bundleSteps(image: string, bundle: string): { exec: string }[] {
  return [
    { exec: `zip -j assets/${bundle} ${image} ${ECR_IMPORT_DIR}/cloudwatch-agent.tar.gz` },
    { exec: `cd src/app && zip -r ../../assets/${bundle} docker/` },
    { exec: `cd src/app/docker && zip ../../../assets/${bundle} appspec.yml` },
    { exec: 'rm -rf src/app/output' },
  ];
}

/**
 * Creates asset building tasks
 * @param project The AwsCdkTypeScriptApp project instance
 */
function createAssetBuildTasks(project: AwsCdkTypeScriptApp): Task {
  // pre-compile has emptied assets/ (the project type's clean step).
  const createDirectories = project.addTask('assets:create-directories', {
    description: 'Create required directories for asset building',
    shell: BASH,
    steps: [
      { exec: 'mkdir -p assets dist' },
      { exec: `rm -rf ${ECR_IMPORT_DIR} && mkdir -p ${ECR_IMPORT_DIR}` },
    ],
  });

  const copyDestinationRules = project.addTask('assets:destination-rules', {
    description: 'Copy destination rules to assets',
    shell: BASH,
    steps: [
      { exec: 'cp src/cdk/configs/destination-rule.yaml assets/' },
      {
        exec: 'for region in us-east-1 us-east-2 us-west-2 eu-west-1 ap-southeast-1 ap-southeast-2; do if [ -f "src/cdk/configs/destination-rule-${region}.yaml" ]; then cp "src/cdk/configs/destination-rule-${region}.yaml" assets/; fi; done',
      },
    ],
  });

  const downloadKubectl = project.addTask('assets:kubectl', {
    description: 'Download kubectl binary',
    shell: BASH,
    exec: `${LOAD_VERSIONS} && curl --fail --location ${LARGE_DOWNLOAD} https://dl.k8s.io/release/v$KUBECTL/bin/linux/arm64/kubectl --output assets/kubectl`,
  });

  const downloadIstioCharts = project.addTask('assets:istio-charts', {
    description: 'Download Istio helm charts',
    shell: BASH,
    exec: `${LOAD_VERSIONS} && for chart in base istiod cni; do curl --fail --location ${CURL_RETRY} $ISTIO_REPO/\${chart}-$ISTIO.tgz --output ${ECR_IMPORT_DIR}/\${chart}-$ISTIO.tgz || exit 1; done`,
  });

  const downloadLbControllerChart = project.addTask('assets:lb-controller-chart', {
    description: 'Download AWS LB controller helm chart',
    shell: BASH,
    exec: `${LOAD_VERSIONS} && curl --fail --location ${CURL_RETRY} $AWS_LOAD_BALANCER_CONTROLLER_REPO/aws-load-balancer-controller-$AWS_LOAD_BALANCER_CONTROLLER.tgz --output ${ECR_IMPORT_DIR}/aws-load-balancer-controller-$AWS_LOAD_BALANCER_CONTROLLER.tgz`,
  });

  const pullIstioContainers = project.addTask('assets:istio-containers', {
    description: 'Pull Istio container images',
    shell: BASH,
    // The distroless variant: no OS package set, so none of the Ubuntu base image's CVEs. Pushed
    // with its own tag (<version>-distroless), which the charts' global.variant selects.
    exec: `${LOAD_VERSIONS} && for image in install-cni proxyv2 pilot; do build/docker-pull-with-retry.sh docker.io/istio/\${image}:$ISTIO-distroless && docker save istio/\${image}:$ISTIO-distroless | gzip > ${ECR_IMPORT_DIR}/\${image}.tar.gz || exit 1; done`,
  });

  const pullLbControllerContainer = project.addTask('assets:lb-controller-container', {
    description: 'Pull AWS LB controller container image',
    shell: BASH,
    exec: `${LOAD_VERSIONS} && build/docker-pull-with-retry.sh public.ecr.aws/eks/aws-load-balancer-controller:v$AWS_LOAD_BALANCER_CONTROLLER-linux_arm64 && docker save public.ecr.aws/eks/aws-load-balancer-controller:v$AWS_LOAD_BALANCER_CONTROLLER-linux_arm64 | gzip > ${ECR_IMPORT_DIR}/aws-load-balancer-controller.tar.gz`,
  });

  const pullCloudwatchAgent = project.addTask('assets:cloudwatch-agent', {
    description: 'Pull CloudWatch agent container image',
    shell: BASH,
    // The pinned tag from build/versions.json, saved as :latest, the tag the EKS app and docker-compose use.
    exec: `${LOAD_VERSIONS} && build/docker-pull-with-retry.sh $CLOUDWATCH_AGENT_IMAGE:$CLOUDWATCH_AGENT && docker tag $CLOUDWATCH_AGENT_IMAGE:$CLOUDWATCH_AGENT cloudwatch-agent/cloudwatch-agent:latest && docker save cloudwatch-agent/cloudwatch-agent:latest | gzip > ${ECR_IMPORT_DIR}/cloudwatch-agent.tar.gz`,
  });

  const downloadDockerCompose = project.addTask('assets:docker-compose', {
    description: 'Download docker compose binary',
    shell: BASH,
    exec: `curl --fail --location ${LARGE_DOWNLOAD} https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-aarch64 --output assets/docker-compose`,
  });

  const buildArm64Container = project.addTask('assets:arm64-container', {
    description: 'Build the arm64 app container (EKS image and the CodeDeploy bundle app_deploy.zip)',
    shell: BASH,
    steps: [
      ...containerBuildSteps(`${ECR_IMPORT_DIR}/container.tar.gz`, false),
      ...bundleSteps(`${ECR_IMPORT_DIR}/container.tar.gz`, 'app_deploy.zip'),
    ],
  });

  const buildFailingArm64Container = project.addTask('assets:arm64-container-fail', {
    description: 'Build the failing arm64 app container (the CodeDeploy bundle app_deploy_fail.zip)',
    shell: BASH,
    steps: [
      ...containerBuildSteps('/tmp/container.tar.gz', true),
      ...bundleSteps('/tmp/container.tar.gz', 'app_deploy_fail.zip'),
      { exec: 'rm /tmp/container.tar.gz' },
    ],
  });

  const buildAssets = project.addTask('build:assets', {
    description: 'Build all workshop assets: assets/ (fetched by name) and the ECR images and charts (dist/ecr-import)',
  });
  for (const t of [createDirectories, copyDestinationRules, downloadKubectl, downloadIstioCharts, downloadLbControllerChart,
    pullIstioContainers, pullLbControllerContainer, pullCloudwatchAgent, downloadDockerCompose, buildArm64Container,
    buildFailingArm64Container]) {
    buildAssets.spawn(t);
  }
  return buildAssets;
}

/**
 * The workshop's own build tasks, in the project type's lifecycle:
 *  - compile: the .NET app and every asset (after pre-compile emptied assets/, before the synth
 *    that takes the images and charts as CDK assets);
 *  - test: the .NET tests, after jest and eslint;
 *  - package: dist/content.zip is also put in assets/, for the guide's "on your own" download.
 */
export function createBuildTasks(project: AwsCdkTypeScriptApp): void {
  const buildApp = createDotnetBuildTasks(project);
  const { unit, integration } = createDotnetTestTasks(project);
  const buildAssets = createAssetBuildTasks(project);

  project.compileTask.spawn(buildApp);
  project.compileTask.spawn(buildAssets);

  project.testTask.spawn(unit);
  project.testTask.spawn(integration);

  // Not inside the zip it is a copy of: removed before package:content zips assets/.
  project.packageTask.prependExec('rm -f assets/content.zip');
  project.packageTask.exec('cp dist/content.zip assets/content.zip');
}
