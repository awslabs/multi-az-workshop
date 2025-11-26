import { AwsCdkTypeScriptApp } from 'projen/lib/awscdk';
import { GithubWorkflow } from 'projen/lib/github';
import { JobPermission } from 'projen/lib/github/workflows-model';
import { UpgradeDependenciesSchedule, NodePackageManager } from 'projen/lib/javascript';

// Centrally defined authorized approvers
export const AUTHORIZED_APPROVERS = ['hakenmt', 'github-bot']; // Will be used in auto-approve workflow (task 13)

// Root project that manages the entire multi-az-workshop monorepo
const project = new AwsCdkTypeScriptApp({
  name: 'multi-az-workshop',
  description: 'The multi-AZ resilience patterns workshop',
  defaultReleaseBranch: 'main',
  projenrcTs: true,
  cdkVersion: '2.222.1',
  appEntrypoint: 'cdk/multi-az-workshop.ts',
  srcdir: 'src',

  // Project metadata
  authorName: 'Michael Haken',
  authorEmail: 'mhaken@amazon.com',
  homepage: 'https://github.com/awslabs/multi-az-workshop',
  repository: 'https://github.com/awslabs/multi-az-workshop',
  license: 'Apache-2.0',

  // Enable default build workflow with custom configuration
  buildWorkflow: true,
  buildWorkflowOptions: {
    preBuildSteps: [
      {
        name: 'Install dotnet',
        uses: 'actions/setup-dotnet@v4',
        with: {
          'dotnet-version': '9.0',
        },
      },
    ],
    mutableBuild: false,
  },
  release: false,

  // Enable GitHub integration
  github: true,

  // Dependency management
  dependabot: false,
  depsUpgrade: true,
  depsUpgradeOptions: {
    workflowOptions: {
      labels: ['auto-approve', 'auto-merge'],
      schedule: UpgradeDependenciesSchedule.WEEKLY,
    },
  },

  // GitHub settings
  githubOptions: {
    mergify: true,
  },

  // Package manager
  packageManager: NodePackageManager.NPM,

  // Minimal dependencies for root project
  devDeps: [
    '@types/node',
    'aws-cdk-lib',
    '@cdklabs/multi-az-observability@0.0.1-alpha.60',
    '@aws-cdk/lambda-layer-kubectl-v31@^2.0.0',
  ],

  // ESLint configuration
  eslintOptions: {
    dirs: ['src', 'test'],
    devdirs: ['src/cdk', 'test', 'build-tools', '.projenrc.ts', 'projenrc'],
    ignorePatterns: ['*.d.ts', '*.js', 'node_modules/', 'lib/'],
  },

  gitignore: [
    '*.d.ts',
    'node_modules/',
    'lib/',
    'coverage/',
    'test-reports/',
    '.DS_Store',
    '**/.DS_Store',
    'tsconfig.tsbuildinfo',
    'package-lock.json',

    // CDK specific
    'cdk.out/',

    // Build artifacts
    'multi-az-workshop.json',
    'content.zip',
    
    'src/app/bin',
    'src/app/obj',
    'src/app/output/',
    
    'assets/**/*',
    
    'tmp/',

  ],
});

// Add global environment variables for all tasks
project.tasks.addEnvironment('PROJECT_NAME', project.name);

// Create deploy workflow
const deployWorkflow = new GithubWorkflow(project.github!, 'deploy');
deployWorkflow.on({
  push: {
    branches: ['main'],
  },
  workflowDispatch: {},
});

// Job 1: Check if deployment is needed
deployWorkflow.addJob('check-changes', {
  runsOn: ['ubuntu-latest'],
  permissions: {},
  outputs: {
    should_deploy: {
      stepId: 'check',
      outputName: 'should_deploy',
    },
  },
  steps: [
    {
      name: 'Checkout',
      uses: 'actions/checkout@v4',
      with: {
        'fetch-depth': 2,
      },
    },
    {
      name: 'Check for src changes',
      id: 'check',
      run: [
        'if [ "${{ github.event_name }}" == "workflow_dispatch" ]; then',
        '  echo "Manual trigger - will deploy"',
        '  echo "should_deploy=true" >> $GITHUB_OUTPUT',
        'elif git diff --name-only HEAD^ HEAD | grep -q "^src/"; then',
        '  echo "Changes detected in src/ - will deploy"',
        '  echo "should_deploy=true" >> $GITHUB_OUTPUT',
        'else',
        '  echo "No changes in src/ - skipping deployment"',
        '  echo "should_deploy=false" >> $GITHUB_OUTPUT',
        'fi',
      ].join('\n'),
    },
  ],
});

// Job 2: Create GitHub deployment
deployWorkflow.addJob('create-deployment', {
  needs: ['check-changes'],
  if: 'needs.check-changes.outputs.should_deploy == \'true\'',
  runsOn: ['ubuntu-latest'],
  permissions: {
    contents: JobPermission.READ,
    deployments: JobPermission.WRITE,
  },
  outputs: {
    deployment_id: {
      stepId: 'create',
      outputName: 'deployment_id',
    },
  },
  env: {
    GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
  },
  steps: [
    {
      name: 'Create deployment',
      id: 'create',
      run: [
        'DEPLOYMENT_ID=$(gh api repos/${{ github.repository }}/deployments \\',
        '  -f ref=${{ github.sha }} \\',
        '  -f environment=AWS \\',
        '  -F auto_merge=false \\',
        '  --jq \'.id\')',
        'echo "deployment_id=$DEPLOYMENT_ID" >> $GITHUB_OUTPUT',
        'echo "Created deployment: $DEPLOYMENT_ID"',
      ].join('\n'),
    },
  ],
});

// Job 3: Bundle and deploy
deployWorkflow.addJob('bundle-and-deploy', {
  needs: ['check-changes', 'create-deployment'],
  if: 'needs.check-changes.outputs.should_deploy == \'true\'',
  runsOn: ['ubuntu-latest'],
  permissions: {
    contents: JobPermission.READ,
    idToken: JobPermission.WRITE,
  },
  environment: {
    name: 'AWS',
  },
  env: {
    CI: 'true',
    PROJECT_NAME: '${{ github.event.repository.name }}',
    BUCKET: '${{ secrets.BUCKET }}',
    AWS_REGION: '${{ secrets.AWS_REGION }}',
    DEPLOYMENT_ROLE: '${{ secrets.DEPLOYMENT_ROLE }}',
  },
  steps: [
    {
      name: 'Checkout',
      uses: 'actions/checkout@v4',
    },
    {
      name: 'Setup Node.js',
      uses: 'actions/setup-node@v4',
      with: {
        'node-version': '20',
      },
    },
    {
      name: 'Setup .NET',
      uses: 'actions/setup-dotnet@v4',
      with: {
        'dotnet-version': '9.0',
      },
    },
    {
      name: 'Install dependencies',
      run: 'npm ci',
    },
    {
      name: 'Configure AWS credentials',
      uses: 'aws-actions/configure-aws-credentials@v5.1.0',
      with: {
        'role-to-assume': '${{ env.DEPLOYMENT_ROLE }}',
        'aws-region': '${{ env.AWS_REGION }}',
        'mask-aws-account-id': true,
      },
    },
    {
      name: 'Bundle and deploy workshop',
      run: 'npx projen bundle-and-deploy',
    },
  ],
});

// Job 4: Report deployment status
deployWorkflow.addJob('report-deployment', {
  needs: ['check-changes', 'create-deployment', 'bundle-and-deploy'],
  if: 'always() && needs.check-changes.outputs.should_deploy == \'true\'',
  runsOn: ['ubuntu-latest'],
  permissions: {
    deployments: JobPermission.WRITE,
  },
  env: {
    GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
  },
  steps: [
    {
      name: 'Report deployment status',
      run: [
        'if [ "${{ needs.bundle-and-deploy.result }}" == "success" ]; then',
        '  STATE="success"',
        'else',
        '  STATE="failure"',
        'fi',
        'gh api repos/${{ github.repository }}/deployments/${{ needs.create-deployment.outputs.deployment_id }}/statuses \\',
        '  -f state=$STATE',
        'echo "Deployment status: $STATE"',
      ].join('\n'),
    },
  ],
});

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

// Add dotnet build to pre-compile to ensure .NET app compiles during CI/CD
const compile = project.tasks.tryFind('compile');
if (compile) {
  compile.spawn(buildApp);
}

// Individual asset building tasks
const createDirectories = project.addTask('assets:create-directories', {
  description: 'Create required directories for asset building',
  exec: 'rm -rf assets && mkdir -p assets',
});

const buildHelmLayer = project.addTask('assets:helm-layer', {
  description: 'Build helm lambda layer',
  steps: [
    {
      exec: 'eval "$(node build/load-versions.js)" && curl --location https://get.helm.sh/helm-v$HELM-linux-arm64.tar.gz --output assets/helm.tar.gz',
    },
    {
      exec: 'tar -zxvf assets/helm.tar.gz --strip-components=1 --directory assets linux-arm64/helm',
    },
    {
      exec: 'chmod 0755 assets/helm',
    },
    {
      exec: 'cd assets && zip helm-layer.zip helm',
    },
    {
      exec: 'rm -f assets/helm.tar.gz assets/helm',
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
    {
      exec: 'rm assets/container.tar.gz'
    }
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
    {
      exec: 'rm assets/container.tar.gz'
    }
  ],
});

project.addTask('assets:package', {
  description: 'Package the assets for testing and deployment',
  steps: [
    {
      exec: 'rm assets/cloudwatch-agent.tar.gz'
    },
    {
      exec: 'cp static/$PROJECT_NAME.json assets/$PROJECT_NAME.json',
    },
    {
      exec: 'cd assets && zip -r ../content.zip .',
    },
    {
      exec: 'mv content.zip assets/content.zip',
    },
    {
      exec: 'find assets -type f ! -name "content.zip" -delete',
    },
  ],
});

project.addTask('assets:cdk-process', {
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

// Combined build-assets task that runs all asset building tasks in order
const buildAssets = project.addTask('build-assets', {
  description: 'Build all workshop assets',
  env: {
    DOCKER_DEFAULT_PLATFORM: 'linux/arm64',
  },
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

// Bundle task - synth CDK, process assets, build assets, and package
project.addTask('bundle-workshop', {
  description: 'Bundle all workshop content for deployment',
  steps: [
    {
      say: 'Building workshop assets...',
    },
    {
      spawn: 'build-assets',
    },
    {
      say: 'Synthesizing CDK application...',
    },
    {
      spawn: 'synth:silent',
    },
    {
      say: 'Processing CDK assets...',
    },
    {
      spawn: 'assets:cdk-process',
    },
    {
      say: 'Packaging assets...',
    },
    {
      spawn: 'assets:package',
    },
  ],
});

// Deploy task - unzip content, upload to S3, create and execute changeset with proper cleanup
project.addTask('deploy-workshop', {
  description: 'Deploy workshop to AWS using CloudFormation',
  steps: [
    {
      say: 'Preparing deployment...',
    },
    {
      exec: 'rm -rf tmp/deploy && mkdir -p tmp/deploy',
    },
    {
      exec: 'unzip -q assets/content.zip -d tmp/deploy',
    },
    {
      say: 'Setting deployment timestamp...',
    },
    {
      exec: 'export ASSETS_PREFIX=$(date --utc +"%Y-%m-%dT%H-%M-%SZ")',
    },
    {
      say: 'Uploading assets to S3...',
    },
    {
      exec: 'aws s3 cp tmp/deploy s3://${BUCKET}/${ASSETS_PREFIX}/ --recursive',
    },
    {
      say: 'Determining stack status...',
    },
    {
      exec: [
        'set +e',
        'aws cloudformation describe-stacks --stack-name ${PROJECT_NAME} --region ${AWS_REGION} >/dev/null 2>&1',
        'EXITCODE=$?',
        'set -e',
        'if [[ $EXITCODE -eq 0 ]]; then',
        '  export CHANGE_SET_TYPE=UPDATE',
        '  export WAIT_CONDITION=update',
        '  echo "Stack exists - will UPDATE"',
        'else',
        '  export CHANGE_SET_TYPE=CREATE',
        '  export WAIT_CONDITION=create',
        '  echo "Stack does not exist - will CREATE"',
        'fi',
      ].join('\n'),
    },
    {
      say: 'Deploying CloudFormation stack...',
    },
    {
      exec: [
        '# Trap to handle cleanup on failure',
        'cleanup_on_failure() {',
        '  echo "Deployment failed - cleaning up new S3 content"',
        '  aws s3 rm s3://${BUCKET}/ --recursive --exclude "*" --include "${ASSETS_PREFIX}/*"',
        '  exit 1',
        '}',
        'trap cleanup_on_failure ERR',
        '',
        '# Create changeset',
        'aws cloudformation create-change-set \\',
        '  --change-set-type ${CHANGE_SET_TYPE} \\',
        '  --stack-name ${PROJECT_NAME} \\',
        '  --change-set-name ${PROJECT_NAME}-${ASSETS_PREFIX} \\',
        '  --template-url https://${BUCKET}.s3.amazonaws.com/${ASSETS_PREFIX}/${PROJECT_NAME}.json \\',
        '  --parameters \\',
        '    ParameterKey=AssetsBucketName,ParameterValue=${BUCKET} \\',
        '    ParameterKey=AssetsBucketPrefix,ParameterValue="${ASSETS_PREFIX}/" \\',
        '  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \\',
        '  --region ${AWS_REGION}',
        '',
        '# Wait for changeset creation',
        'aws cloudformation wait change-set-create-complete \\',
        '  --stack-name ${PROJECT_NAME} \\',
        '  --change-set-name ${PROJECT_NAME}-${ASSETS_PREFIX} \\',
        '  --region ${AWS_REGION}',
        '',
        '# Execute changeset',
        'aws cloudformation execute-change-set \\',
        '  --stack-name ${PROJECT_NAME} \\',
        '  --change-set-name ${PROJECT_NAME}-${ASSETS_PREFIX} \\',
        '  --region ${AWS_REGION}',
        '',
        '# Wait for stack completion',
        'aws cloudformation wait stack-${WAIT_CONDITION}-complete \\',
        '  --stack-name ${PROJECT_NAME} \\',
        '  --region ${AWS_REGION}',
        '',
        '# Remove trap after successful deployment',
        'trap - ERR',
      ].join('\n'),
    },
    {
      say: 'Deployment succeeded!',
    },
    {
      exec: [
        'echo "Cleaning up old S3 content due to successful deployment"',
        'aws s3 rm s3://${BUCKET}/ --recursive --exclude "${ASSETS_PREFIX}/*"',
      ].join('\n'),
    },
    {
      say: 'Deployment complete!',
    },
  ],
});

// Combined bundle-and-deploy task
project.addTask('bundle-and-deploy', {
  description: 'Bundle and deploy workshop to AWS',
  steps: [
    {
      spawn: 'bundle-workshop',
    },
    {
      spawn: 'deploy-workshop',
    },
  ],
});

project.synth();
