import { AwsCdkTypeScriptApp } from 'projen/lib/awscdk';
import { Task } from 'projen/lib/task';

/**
 * Configuration for a task step
 */
export interface TaskStep {
  exec?: string;
  spawn?: string;
  say?: string;
}

/**
 * Configuration for a task
 */
export interface TaskConfig {
  name: string;
  description: string;
  steps?: TaskStep[];
  env?: Record<string, string>;
  requiredEnv?: string[];
}

/**
 * Configuration for asset building
 */
export interface AssetConfig {
  name: string;
  description: string;
  buildSteps: TaskStep[];
  dependencies?: string[];
}

/**
 * Creates .NET application build tasks
 * @param project The AwsCdkTypeScriptApp project instance
 */
function createDotnetBuildTasks(project: AwsCdkTypeScriptApp): Task {
  const buildApp = project.addTask('build:app', {
    description: 'Build .NET application',
    steps: [
      {
        exec: 'rm -rf src/app/output',
      },
      {
        exec: 'mkdir -p src/app/output/src',
      },
      {
        exec: 'dotnet publish src/app/multi-az-workshop-application.csproj --configuration Release --runtime linux-musl-arm64 --output src/app/output/src -p:PublishReadyToRun=true -p:PublishReadyToRunShowWarnings=true --self-contained',
      },
    ],
  });

  return buildApp;
}

/**
 * Creates .NET test tasks
 * @param project The AwsCdkTypeScriptApp project instance
 */
function createDotnetTestTasks(project: AwsCdkTypeScriptApp): { unit: Task; integration: Task } {
  const testAppUnit = project.addTask('test:app:unit', {
    description: 'Run .NET unit tests',
    env: {
      AWS_EC2_METADATA_DISABLED: 'true',
      AWS_ACCESS_KEY_ID: 'fake',
      AWS_SECRET_ACCESS_KEY: 'fake',
      AWS_DEFAULT_REGION: 'us-east-1',
    },
    exec: 'dotnet test test/app --filter "FullyQualifiedName!~Integration" --configuration Release --logger "console;verbosity=detailed"',
  });

  const testAppIntegration = project.addTask('test:app:integration', {
    description: 'Run .NET integration tests',
    env: {
      AWS_EC2_METADATA_DISABLED: 'true',
      AWS_ACCESS_KEY_ID: 'fake',
      AWS_SECRET_ACCESS_KEY: 'fake',
      AWS_DEFAULT_REGION: 'us-east-1',
    },
    exec: 'dotnet test test/app --filter "FullyQualifiedName~Integration" --configuration Release --logger "console;verbosity=detailed"',
  });

  return { unit: testAppUnit, integration: testAppIntegration };
}

/**
 * Creates asset building tasks
 * @param project The AwsCdkTypeScriptApp project instance
 */
function createAssetBuildTasks(project: AwsCdkTypeScriptApp): Task {
  // Individual asset building tasks
  const createDirectories = project.addTask('assets:create-directories', {
    description: 'Create required directories for asset building',
    steps: [
      {
        exec: 'rm -rf assets && mkdir -p assets',
      },
      {
        exec: 'rm -rf dist && mkdir -p dist',
      },
    ],
  });

  const buildHelmLayer = project.addTask('assets:helm-layer', {
    description: 'Build helm lambda layer',
    steps: [
      {
        exec: 'eval "$(node build/load-versions.js)" && curl --location https://get.helm.sh/helm-v$HELM-linux-arm64.tar.gz --output assets/helm.tar.gz',
      },
      {
        exec: 'mkdir -p assets/helm',
      },
      {
        exec: 'tar -zxvf assets/helm.tar.gz --strip-components=1 --directory assets/helm linux-arm64/helm',
      },
      {
        exec: 'chmod 0755 assets/helm/helm',
      },
      {
        exec: 'cd assets && zip -r helm-layer.zip helm/',
      },
      {
        exec: 'rm -rf assets/helm.tar.gz assets/helm',
      },
    ],
  });

  const copyDestinationRules = project.addTask('assets:destination-rules', {
    description: 'Copy destination rules to assets',
    steps: [
      {
        exec: 'cp src/cdk/configs/destination-rule.yaml assets/',
      },
      {
        exec: 'for region in us-east-1 us-east-2 us-west-2 eu-west-1 ap-southeast-1 ap-southeast-2; do [ -f "src/cdk/configs/destination-rule-${region}.yaml" ] && cp "src/cdk/configs/destination-rule-${region}.yaml" "assets/"; done',
      },
    ],
  });

  const downloadKubectl = project.addTask('assets:kubectl', {
    description: 'Download kubectl binary',
    exec: 'eval "$(node build/load-versions.js)" && curl --location https://dl.k8s.io/release/v$KUBECTL/bin/linux/arm64/kubectl --output assets/kubectl',
  });

  const downloadIstioCharts = project.addTask('assets:istio-charts', {
    description: 'Download Istio helm charts',
    exec: 'eval "$(node build/load-versions.js)" && for chart in base istiod gateway cni; do curl --location https://istio-release.storage.googleapis.com/charts/${chart}-$ISTIO.tgz --output assets/${chart}-$ISTIO.tgz; done',
  });

  const downloadLbControllerChart = project.addTask('assets:lb-controller-chart', {
    description: 'Download AWS LB controller helm chart',
    exec: 'eval "$(node build/load-versions.js)" && curl --location https://aws.github.io/eks-charts/aws-load-balancer-controller-$LB_CONTROLLER_HELM.tgz --output assets/aws-load-balancer-controller-$LB_CONTROLLER_HELM.tgz',
  });

  const pullIstioContainers = project.addTask('assets:istio-containers', {
    description: 'Pull Istio container images',
    exec: 'eval "$(node build/load-versions.js)" && for image in install-cni proxyv2 pilot; do docker pull docker.io/istio/${image}:$ISTIO && docker save istio/${image}:$ISTIO | gzip > assets/${image}.tar.gz; done',
  });

  const pullLbControllerContainer = project.addTask('assets:lb-controller-container', {
    description: 'Pull AWS LB controller container image',
    exec: 'eval "$(node build/load-versions.js)" && docker pull public.ecr.aws/eks/aws-load-balancer-controller:$LB_CONTROLLER_CONTAINER-linux_arm64 && docker save public.ecr.aws/eks/aws-load-balancer-controller:$LB_CONTROLLER_CONTAINER-linux_arm64 | gzip > assets/aws-load-balancer-controller.tar.gz',
  });

  const pullCloudwatchAgent = project.addTask('assets:cloudwatch-agent', {
    description: 'Pull CloudWatch agent container image',
    exec: 'docker pull public.ecr.aws/cloudwatch-agent/cloudwatch-agent:latest && docker tag public.ecr.aws/cloudwatch-agent/cloudwatch-agent:latest cloudwatch-agent/cloudwatch-agent:latest && docker save cloudwatch-agent/cloudwatch-agent:latest | gzip > assets/cloudwatch-agent.tar.gz',
  });

  const downloadDockerCompose = project.addTask('assets:docker-compose', {
    description: 'Download docker compose binary',
    exec: 'curl -SL https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-aarch64 -o assets/docker-compose',
  });

  const buildArm64Container = project.addTask('assets:arm64-container', {
    description: 'Build arm64 container',
    env: {
      FILE_NAME: 'app_deploy.zip',
    },
    steps: [
      {
        exec: 'rm -rf src/app/output',
      },
      {
        exec: 'mkdir -p src/app/output/src',
      },
      {
        exec: 'cd src/app && dotnet publish --configuration Release --runtime linux-musl-arm64 --output output/src -p:PublishReadyToRun=true -p:PublishReadyToRunShowWarnings=true --self-contained',
      },
      {
        exec: 'docker build --tag $PROJECT_NAME:latest --platform linux/arm64 --build-arg SRC=src --file build/dockerfile src/app/output',
      },
      {
        exec: 'docker save $PROJECT_NAME:latest | gzip > assets/container.tar.gz',
      },
      {
        exec: 'zip -j assets/$FILE_NAME assets/container.tar.gz assets/cloudwatch-agent.tar.gz',
      },
      {
        exec: 'cd src/app && zip -r ../../assets/$FILE_NAME docker/',
      },
      {
        exec: 'cd src/app/docker && zip ../../../assets/$FILE_NAME appspec.yml',
      },
      {
        exec: 'rm -rf src/app/output',
      },
    ],
  });

  const buildFailingArm64Container = project.addTask('assets:arm64-container-fail', {
    description: 'Build failing arm64 container',
    env: {
      FILE_NAME: 'app_deploy_fail.zip',
    },
    steps: [
      {
        exec: 'rm -rf src/app/output',
      },
      {
        exec: 'mkdir -p src/app/output/src',
      },
      {
        exec: 'cd src/app && dotnet publish --configuration Release --runtime linux-musl-arm64 --output output/src -p:DefineConstants="FAIL" -p:PublishReadyToRun=true -p:PublishReadyToRunShowWarnings=true --self-contained',
      },
      {
        exec: 'docker build --tag $PROJECT_NAME:latest --platform linux/arm64 --build-arg SRC=src --file build/dockerfile src/app/output',
      },
      {
        exec: 'docker save $PROJECT_NAME:latest | gzip > /tmp/container.tar.gz',
      },
      {
        exec: 'zip -j assets/$FILE_NAME /tmp/container.tar.gz assets/cloudwatch-agent.tar.gz',
      },
      {
        exec: 'cd src/app && zip -r ../../assets/$FILE_NAME docker/',
      },
      {
        exec: 'cd src/app/docker && zip ../../../assets/$FILE_NAME appspec.yml',
      },
      {
        exec: 'rm -rf src/app/output',
      },
      {
        exec: 'rm /tmp/container.tar.gz',
      },
    ],
  });

  // Combined build-assets task that runs all asset building tasks in order
  const buildAssets = project.addTask('build:assets', {
    description: 'Build all workshop assets',
  });

  // Add all asset tasks as dependencies in the correct order
  buildAssets.spawn(createDirectories);
  buildAssets.spawn(buildHelmLayer);
  buildAssets.spawn(copyDestinationRules);
  buildAssets.spawn(downloadKubectl);
  buildAssets.spawn(downloadIstioCharts);
  buildAssets.spawn(downloadLbControllerChart);
  buildAssets.spawn(pullIstioContainers);
  buildAssets.spawn(pullLbControllerContainer);
  buildAssets.spawn(pullCloudwatchAgent);
  buildAssets.spawn(downloadDockerCompose);
  buildAssets.spawn(buildArm64Container);
  buildAssets.spawn(buildFailingArm64Container);

  return buildAssets;
}

/**
 * Creates CDK asset processing tasks
 * @param project The AwsCdkTypeScriptApp project instance
 */
function createCdkAssetProcessingTasks(project: AwsCdkTypeScriptApp): { cdkProcess: Task; packageAssets: Task } {
  const processCdkAssets = project.addTask('assets:cdk-process', {
    description: 'Processes the synthesized CDK files to make them ready for deployment and copies them to assets folder',
    steps: [
      {
        exec: 'chmod +x build/package.py',
      },
      {
        exec: 'build/package.py $PROJECT_NAME .',
      },
    ],
  });

  const packageAssets = project.addTask('assets:package', {
    description: 'Package the assets for testing and deployment',
    steps: [
      {
        exec: 'cp static/$PROJECT_NAME.json assets/$PROJECT_NAME.json',
      },
      {
        exec: 'cd assets && zip -r ../dist/content.zip .',
      },
    ],
  });

  return { cdkProcess: processCdkAssets, packageAssets };
}

/**
 * Extends the native compile task to include .NET build and asset building
 * @param project The AwsCdkTypeScriptApp project instance
 * @param buildApp The .NET build task
 * @param buildAssets The asset building task
 */
function extendCompileTask(project: AwsCdkTypeScriptApp, buildApp: Task, buildAssets: Task): void {
  const compile = project.tasks.tryFind('compile');
  if (compile) {
    compile.spawn(buildApp);
    compile.spawn(buildAssets);
  }
}

/**
 * Extends the native test task to include .NET tests
 * @param project The AwsCdkTypeScriptApp project instance
 * @param testAppUnit The .NET unit test task
 * @param testAppIntegration The .NET integration test task
 */
function extendTestTask(project: AwsCdkTypeScriptApp, testAppUnit: Task, testAppIntegration: Task): void {
  const test = project.tasks.tryFind('test');
  if (test) {
    test.spawn(testAppUnit);
    test.spawn(testAppIntegration);
  }
}

/**
 * Overrides the native package task to create content.zip
 * @param project The AwsCdkTypeScriptApp project instance
 * @param cdkProcess The CDK asset processing task
 * @param packageAssets The asset packaging task
 */
function overridePackageTask(project: AwsCdkTypeScriptApp, cdkProcess: Task, packageAssets: Task): void {
  const packageTask = project.tasks.tryFind('package');
  if (packageTask) {
    packageTask.reset();
    packageTask.exec('mkdir -p dist');
    packageTask.say('Processing CDK assets...');
    packageTask.spawn(cdkProcess);
    packageTask.say('Packaging assets...');
    packageTask.spawn(packageAssets);
  }
}

/**
 * Creates all build-related tasks for the project
 * @param project The AwsCdkTypeScriptApp project instance
 */
export function createBuildTasks(project: AwsCdkTypeScriptApp): void {
  // Create .NET build tasks
  const buildApp = createDotnetBuildTasks(project);

  // Create .NET test tasks
  const { unit: testAppUnit, integration: testAppIntegration } = createDotnetTestTasks(project);

  // Create asset building tasks
  const buildAssets = createAssetBuildTasks(project);

  // Create CDK asset processing tasks
  const { cdkProcess, packageAssets } = createCdkAssetProcessingTasks(project);

  // Extend native compile task to include .NET build and asset building
  extendCompileTask(project, buildApp, buildAssets);

  // Extend native test task to include .NET tests
  extendTestTask(project, testAppUnit, testAppIntegration);

  // Override native package task to create content.zip
  overridePackageTask(project, cdkProcess, packageAssets);

  // Native build task automatically runs compile → test → package
}
