import * as fs from 'fs';
import * as path from 'path';
import { typescript } from 'projen';
import { UpgradeDependenciesSchedule, NodePackageManager } from 'projen/lib/javascript';

// Root project that manages the entire multi-az-workshop monorepo
const project = new typescript.TypeScriptProject({
  name: 'multi-az-workshop',
  description: 'The multi-AZ resilience patterns workshop',
  defaultReleaseBranch: 'main',
  projenrcTs: true,

  // Project metadata
  authorName: 'Michael Haken',
  authorEmail: 'mhaken@amazon.com',
  homepage: 'https://github.com/awslabs/multi-az-workshop',
  repository: 'https://github.com/awslabs/multi-az-workshop',
  license: 'Apache-2.0',

  // Disable default workflows - we'll manage them ourselves
  buildWorkflow: false,
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
    'aws-cdk-lib@2.189.1',
    '@cdklabs/multi-az-observability@0.0.1-alpha.60',
    '@aws-cdk/lambda-layer-kubectl-v31@^2.0.0',
  ],

  gitignore: [
    '*.d.ts',
    '*.js',
    'node_modules/',
    'coverage/',
    'test-reports/',
    '.DS_Store',
    '**/.DS_Store',
    'tsconfig.tsbuildinfo',
    'package-lock.json',

    // CDK specific
    'src/cdk/.cdk.staging',
    'src/cdk/cdk.out',
    'cdk/.cdk.staging',
    'cdk/cdk.out',
    'cdk/bin/',
    'cdk/obj/',

    // Build artifacts
    'src/app/bin',
    'src/app/obj',
    'assets/**/*',
    'src/cdk/helm-layer.zip',
    'src/cdk/layer/',
    'cdk/helm-layer.zip',
    'cdk/layer/',
    'tmp/',
    'src/app/output/',
    'app-src/output/',
    'content.zip',
    '*.tar.gz',
  ],
});

// Load versions from versions.json
const versionsPath = path.join(__dirname, 'build', 'versions.json');
let versions: Record<string, string> = {};
try {
  versions = JSON.parse(fs.readFileSync(versionsPath, 'utf-8'));
  console.log('✅ Loaded versions from build/versions.json');
} catch (error) {
  console.warn('⚠️  Could not load versions.json, using defaults');
  versions = {
    HELM: '3.16.3',
    KUBECTL: '1.32.0',
    ISTIO: '1.24.1',
    LB_CONTROLLER_HELM: '1.10.1',
    LB_CONTROLLER_CONTAINER: 'v2.8.1',
  };
}

// Add global environment variables for all tasks
project.tasks.addEnvironment('PROJECT_NAME', project.name);

// CDK build task
project.addTask('cdk:build', {
  description: 'Build CDK project',
  exec: 'tsc --project tsconfig.json',
});

// CDK synth task
project.addTask('cdk:synth', {
  description: 'Synthesize CDK stack',
  exec: 'cdk synth --app "node lib/cdk/multi-az-workshop.js"',
});

// CDK deploy task
project.addTask('cdk:deploy', {
  description: 'Deploy CDK stack',
  exec: 'cdk deploy --app "node lib/cdk/multi-az-workshop.js"',
});

// Full build task that mirrors GitHub workflow
project.addTask('build:local', {
  description: 'Build entire project locally (mirrors GitHub workflow)',
  env: {
    CDK_LOCATION: 'src/cdk',
    PROJECT_NAME: 'multi-az-workshop',
    BUILD_APP: 'false',
    ...versions,
  },
  steps: [
    {
      name: 'Create directories',
      exec: [
        'mkdir -p tmp',
        'mkdir -p assets',
        'mkdir -p src/cdk/layer/helm',
      ].join(' && '),
    },
    {
      name: 'Create helm lambda layer',
      exec: [
        'curl --location https://get.helm.sh/helm-v$HELM-linux-arm64.tar.gz --output /tmp/helm.tar.gz',
        'tar -zxvf /tmp/helm.tar.gz --directory /tmp',
        'cp /tmp/linux-arm64/helm src/cdk/layer/helm/',
        'chmod 0755 src/cdk/layer/helm/helm',
        'cd src/cdk/layer && zip -r ../../../helm-layer.zip .',
      ].join(' && '),
    },
    {
      name: 'Copy destination rules',
      exec: [
        'cp src/cdk/configs/destination-rule.yaml assets/',
        'for region in us-east-1 us-east-2 us-west-2 eu-west-1 ap-southeast-1 ap-southeast-2; do [ -f "src/cdk/configs/destination-rule-${region}.yaml" ] && cp "src/cdk/configs/destination-rule-${region}.yaml" "assets/"; done',
      ].join(' && '),
    },
    {
      name: 'Download kubectl',
      exec: 'curl --location https://dl.k8s.io/release/v$KUBECTL/bin/linux/arm64/kubectl --output assets/kubectl',
    },
    {
      name: 'Download Istio helm charts',
      exec: 'for chart in base istiod gateway cni; do curl --location https://istio-release.storage.googleapis.com/charts/${chart}-$ISTIO.tgz --output assets/${chart}-$ISTIO.tgz; done',
    },
    {
      name: 'Download AWS LB controller helm chart',
      exec: 'curl --location https://aws.github.io/eks-charts/aws-load-balancer-controller-$LB_CONTROLLER_HELM.tgz --output assets/aws-load-balancer-controller-$LB_CONTROLLER_HELM.tgz',
    },
    {
      name: 'Pull Istio containers',
      exec: 'for image in install-cni proxyv2 pilot; do docker pull docker.io/istio/${image}:$ISTIO && docker save istio/${image}:$ISTIO | gzip > assets/${image}.tar.gz; done',
    },
    {
      name: 'Pull load balancer controller container',
      exec: 'docker pull public.ecr.aws/eks/aws-load-balancer-controller:$LB_CONTROLLER_CONTAINER-linux_arm64 && docker save public.ecr.aws/eks/aws-load-balancer-controller:$LB_CONTROLLER_CONTAINER-linux_arm64 | gzip > assets/aws-load-balancer-controller.tar.gz',
    },
    {
      name: 'Pull cloudwatch agent container',
      exec: 'docker pull public.ecr.aws/cloudwatch-agent/cloudwatch-agent:latest && docker tag public.ecr.aws/cloudwatch-agent/cloudwatch-agent:latest cloudwatch-agent/cloudwatch-agent:latest && docker save cloudwatch-agent/cloudwatch-agent:latest | gzip > assets/cloudwatch-agent.tar.gz',
    },
    {
      name: 'Download docker compose',
      exec: 'curl -SL https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-aarch64 -o assets/docker-compose',
    },
    {
      name: 'Build arm64 container',
      exec: [
        'rm -rf src/app/output',
        'mkdir -p src/app/output/src',
        'cd src/app && dotnet publish --configuration Release --runtime linux-musl-arm64 --output output/src -p:PublishReadyToRun=true -p:PublishReadyToRunShowWarnings=true --self-contained',
        'cd src/app/output && docker build --tag $PROJECT_NAME:latest --platform linux/arm64 --build-arg SRC=src --file ../../../build/dockerfile .',
        'docker save $PROJECT_NAME:latest | gzip > ../../../assets/container.tar.gz',
        'cd assets && zip -j app_deploy.zip container.tar.gz cloudwatch-agent.tar.gz',
        'cd src/app && zip -r ../../assets/app_deploy.zip docker/',
        'cd src/app/docker && zip ../../../assets/app_deploy.zip appspec.yml',
        'rm -rf src/app/output',
      ].join(' && '),
    },
    {
      name: 'Build failing arm64 container',
      exec: [
        'rm -rf src/app/output',
        'mkdir -p src/app/output',
        'mkdir -p src/app/output/src',
        'cd src/app && dotnet publish --configuration Release --runtime linux-musl-arm64 --output output/src -p:DefineConstants="FAIL" -p:PublishReadyToRun=true -p:PublishReadyToRunShowWarnings=true --self-contained',
        'cd src/app/output && docker build --tag $PROJECT_NAME:latest --platform linux/arm64 --build-arg SRC=src --file ../../../build/dockerfile .',
        'docker save $PROJECT_NAME:latest | gzip > /tmp/container.tar.gz',
        'zip -j assets/app_deploy_fail.zip /tmp/container.tar.gz',
        'zip -j assets/app_deploy_fail.zip assets/cloudwatch-agent.tar.gz',
        'cd src/app && zip -r ../../assets/app_deploy_fail.zip docker/',
        'cd src/app/docker && zip ../../../assets/app_deploy_fail.zip appspec.yml',
        'rm -f /tmp/container.tar.gz',
        'rm -rf src/app/output',
      ].join(' && '),
    },
    {
      name: 'Build assets and create content.zip',
      exec: [
        'cdk synth --quiet --app "node lib/cdk/multi-az-workshop.js"',
        'chmod +x build/package.py',
        './build/package.py $PROJECT_NAME . src/cdk',
        'cd assets && zip -r ../content.zip .',
        'cp static/$PROJECT_NAME.json $PROJECT_NAME.template',
        'zip content.zip $PROJECT_NAME.template',
        'cp content.zip assets/',
      ].join(' && '),
    },
  ],
});

// Add build workflow that mirrors the reference build.yml
if (project.github) {
  const buildWorkflow = project.github.addWorkflow('build');
  
  buildWorkflow.on({
    pullRequest: {
      types: ['opened', 'synchronize'],
      branches: ['main'],
    },
  });

  // Set permissions
  buildWorkflow.addJob('filter', {
    permissions: {},
    runsOn: ['ubuntu-latest'],
    outputs: {
      should_run: { stepId: 'check', outputName: 'should_run' },
    },
    env: {
      IGNORE_PATTERNS: '^\.github/workflows/ ^\.aws/ ^\.kiro/',
    },
    steps: [
      {
        name: 'Checkout',
        uses: 'actions/checkout@v4',
        with: {
          'fetch-depth': 0,
        },
      },
      {
        name: 'Get changed files',
        id: 'diff',
        run: [
          'if [ "${{ github.event_name }}" = "pull_request" ]; then',
          '  base_sha="${{ github.event.pull_request.base.sha }}"',
          '  head_sha="${{ github.event.pull_request.head.sha }}"',
          'else',
          '  # push event',
          '  base_sha="${{ github.event.before }}"',
          '  head_sha="${{ github.sha }}"',
          'fi',
          '',
          'echo "Comparing $base_sha...$head_sha"',
          'git diff --name-only "$base_sha" "$head_sha" > files.txt',
          'echo "Changed files:"',
          'cat files.txt',
        ].join('\n'),
      },
      {
        name: 'Decide if only ignored paths changed',
        id: 'check',
        run: [
          '# Split IGNORE_PATTERNS env var into a bash array',
          'read -ra PATTERNS <<< "$IGNORE_PATTERNS"',
          '',
          'echo "Ignore patterns:"',
          'printf \'  %s\\n\' "${PATTERNS[@]}"',
          '',
          'only_ignored=true',
          '',
          'while read -r file; do',
          '  [ -z "$file" ] && continue',
          '',
          '  matched=false',
          '  for pattern in "${PATTERNS[@]}"; do',
          '    if [[ "$file" =~ $pattern ]]; then',
          '      matched=true',
          '      break',
          '    fi',
          '  done',
          '',
          '  if [ "$matched" = false ]; then',
          '    echo "Non-ignored change detected: $file"',
          '    only_ignored=false',
          '    break',
          '  fi',
          'done < files.txt',
          '',
          'if [ "$only_ignored" = true ]; then',
          '  echo "All changes are in ignored paths. Skipping build jobs."',
          '  echo "should_run=false" >> "$GITHUB_OUTPUT"',
          'else',
          '  echo "There are non-ignored changes. Running full workflow."',
          '  echo "should_run=true" >> "$GITHUB_OUTPUT"',
          'fi',
        ].join('\n'),
      },
    ],
  });

  // Build job
  buildWorkflow.addJob('build', {
    needs: ['filter'],
    permissions: {
      contents: 'read' as any,
    },
    runsOn: ['ubuntu-24.04-arm'],
    env: {
      CDK_LOCATION: 'cdk',
      PROJECT_NAME: '${{ github.event.repository.name }}',
      DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '0',
      BUILD_APP: 'false',
      USE_CODEBUILD: 'false',
    },
    steps: [
      {
        name: 'Check if build should run',
        id: 'should-build',
        run: [
          'if [ "${{ needs.filter.outputs.should_run }}" = "false" ]; then',
          '  echo "Only ignored paths changed. Skipping build steps."',
          '  echo "skip=true" >> $GITHUB_OUTPUT',
          'else',
          '  echo "skip=false" >> $GITHUB_OUTPUT',
          'fi',
        ].join('\n'),
      },
      {
        name: 'Checkout code',
        if: 'steps.should-build.outputs.skip == \'false\'',
        uses: 'actions/checkout@v4',
        with: {
          ref: '${{ github.event.pull_request.head.ref }}',
          repository: '${{ github.event.pull_request.head.repo.full_name }}',
        },
      },
      {
        name: 'Install dotnet',
        if: 'steps.should-build.outputs.skip == \'false\'',
        uses: 'actions/setup-dotnet@v4',
        with: {
          'dotnet-version': '9.0',
        },
      },
      {
        name: 'Dotnet version update',
        if: 'steps.should-build.outputs.skip == \'false\' && env.USE_CODEBUILD == \'true\'',
        run: [
          'cat /codebuild/global.json',
          'dotnet --info',
          'jq \'.sdk.version = "9.0.0"\' /codebuild/global.json > temp.json && mv temp.json /codebuild/global.json',
          'cat /codebuild/global.json',
        ].join('\n'),
      },
      {
        name: 'Install cdk',
        if: 'steps.should-build.outputs.skip == \'false\'',
        run: [
          'npm install aws-cdk -g',
          'cdk --version',
        ].join('\n'),
      },
      {
        name: 'Create tmp',
        if: 'steps.should-build.outputs.skip == \'false\'',
        run: 'mkdir -p ${{ github.workspace }}/tmp',
      },
      {
        name: 'Create assets',
        if: 'steps.should-build.outputs.skip == \'false\'',
        run: 'mkdir -p ${{ github.workspace }}/assets',
      },
      {
        name: 'Set versions',
        if: 'steps.should-build.outputs.skip == \'false\'',
        run: [
          '# Read the JSON file and iterate over each key-value pair',
          'for key in $(jq -r \'keys[]\' ${{ github.workspace }}/build/versions.json); do',
          '  value=$(jq -r ".\\"$key\\"" ${{ github.workspace }}/build/versions.json)',
          '  echo "Setting environment variable for $key with value $value"',
          '  # Set the environment variable',
          '  echo "$key=$value" >> $GITHUB_ENV',
          'done',
        ].join('\n'),
      },
      {
        name: 'Create helm lambda layer',
        if: 'steps.should-build.outputs.skip == \'false\'',
        run: [
          'file=helm-v$HELM-linux-arm64.tar.gz',
          'curl --location https://get.helm.sh/$file --output /tmp/$file',
          'tar -zxvf /tmp/$file --directory /tmp',
          'mkdir -p ${{ github.workspace }}/$CDK_LOCATION/layer/helm',
          'cp /tmp/linux-arm64/helm ${{ github.workspace }}/$CDK_LOCATION/layer/helm/',
          'chmod 0755 ${{ github.workspace }}/$CDK_LOCATION/layer/helm/helm',
          'cd ${{ github.workspace }}/$CDK_LOCATION/layer',
          'zip -r ${{ github.workspace }}/$CDK_LOCATION/helm-layer.zip .',
        ].join('\n'),
      },
      {
        name: 'Copy destination rules',
        if: 'steps.should-build.outputs.skip == \'false\'',
        run: [
          'file=destination-rule.yaml',
          'src_dir="${{ github.workspace }}/$CDK_LOCATION/Configs"',
          'dest_dir="${{ github.workspace }}/assets"',
          'cp $src_dir/$file $dest_dir/$file',
          'regions=(us-east-1 us-east-2 us-west-2 eu-west-1 ap-southeast-1 ap-southeast-2)',
          'for region in "${regions[@]}"; do',
          '  regional_file="destination-rule-${region}.yaml"',
          '  if [[ -f "$src_dir/$regional_file" ]]; then',
          '    cp "$src_dir/$regional_file" "$dest_dir/$regional_file"',
          '  fi',
          'done',
        ].join('\n'),
      },
      {
        name: 'Get kubectl',
        if: 'steps.should-build.outputs.skip == \'false\'',
        run: [
          'file=kubectl',
          'curl --location https://dl.k8s.io/release/v$KUBECTL/bin/linux/arm64/$file --output ${{ github.workspace }}/assets/$file',
        ].join('\n'),
      },
      {
        name: 'Get istio helm charts',
        if: 'steps.should-build.outputs.skip == \'false\'',
        run: [
          'BASE=https://istio-release.storage.googleapis.com/charts',
          'istio_deps=("base-$ISTIO.tgz" "istiod-$ISTIO.tgz" "gateway-$ISTIO.tgz" "cni-$ISTIO.tgz")',
          'for file in ${istio_deps[@]}; do',
          '  curl --location $BASE/$file --output ${{ github.workspace }}/assets/$file',
          'done',
        ].join('\n'),
      },
      {
        name: 'Get AWS load balancer controller helm chart',
        if: 'steps.should-build.outputs.skip == \'false\'',
        run: [
          'file=aws-load-balancer-controller-$LB_CONTROLLER_HELM.tgz',
          'curl --location https://aws.github.io/eks-charts/$file --output ${{ github.workspace }}/assets/$file',
        ].join('\n'),
      },
      {
        name: 'Pull istio containers',
        if: 'steps.should-build.outputs.skip == \'false\'',
        run: [
          'MAX_RETRIES=10',
          'SLEEP_INTERVAL=2',
          'IMAGES=(install-cni proxyv2 pilot)',
          'if [[ "$USE_CODEBUILD" == "true" ]]; then',
          '  ACCOUNT_ID=$(echo "$CODEBUILD_BUILD_ARN" | cut -d\':\' -f5)',
          '  BASE=$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/docker-hub',
          '  SEARCH_BASE=$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/docker-hub/',
          '  aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com',
          'else',
          '  BASE=docker.io',
          '  SEARCH_BASE=""',
          'fi',
          '',
          'for image in "${IMAGES[@]}"; do',
          '  SOURCE=$BASE/istio/$image:$ISTIO',
          '  SEARCH=${SEARCH_BASE}istio/$image:$ISTIO',
          '  docker pull $SOURCE',
          '  ',
          '  retries=0',
          '  while ! docker images --format "{{.Repository}}:{{.Tag}}" | grep -q "^$SEARCH$"; do',
          '    if [ "$retries" -ge "$MAX_RETRIES" ]; then',
          '      echo "Image $SEARCH did not appear in \'docker images\' after $((MAX_RETRIES * SLEEP_INTERVAL)) seconds. Exiting."',
          '      exit 1',
          '    fi',
          '',
          '    echo "Retry $((retries+1))/$MAX_RETRIES - Image not found yet. Retrying in $SLEEP_INTERVAL seconds..."',
          '    sleep "$SLEEP_INTERVAL"',
          '    retries=$((retries+1))',
          '  done',
          '',
          '  if [ "$SEARCH" != "istio/$image:$ISTIO" ]; then',
          '    docker tag $SEARCH istio/$image:$ISTIO',
          '  fi',
          '  docker save istio/$image:$ISTIO | gzip > ${{ github.workspace }}/assets/$image.tar.gz',
          'done',
        ].join('\n'),
      },
      {
        name: 'Pull load balancer controller container image',
        if: 'steps.should-build.outputs.skip == \'false\'',
        run: [
          'BASE=public.ecr.aws',
          'file="eks/aws-load-balancer-controller:$LB_CONTROLLER_CONTAINER-linux_arm64"',
          'docker pull $BASE/$file',
          'name=$(echo $file | cut -d \'/\' -f2 | cut -d \':\' -f1)',
          'docker save $BASE/$file | gzip > ${{ github.workspace }}/assets/$name.tar.gz',
        ].join('\n'),
      },
      {
        name: 'Pull cloudwatch agent container image',
        if: 'steps.should-build.outputs.skip == \'false\'',
        run: [
          'BASE=public.ecr.aws',
          'file="cloudwatch-agent/cloudwatch-agent:latest"',
          'docker pull $BASE/$file',
          'docker tag $BASE/$file $file',
          'name=$(echo $file | cut -d \'/\' -f2 | cut -d \':\' -f1)',
          'docker save $file | gzip > ${{ github.workspace }}/assets/$name.tar.gz',
        ].join('\n'),
      },
      {
        name: 'Pull docker compose',
        if: 'steps.should-build.outputs.skip == \'false\'',
        run: 'curl -SL https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-aarch64 -o ${{ github.workspace }}/assets/docker-compose',
      },
      {
        name: 'Build arm64 web app',
        if: 'steps.should-build.outputs.skip == \'false\' && env.BUILD_APP == \'true\'',
        run: [
          'rm -rf ${{ github.workspace }}/app-src/output',
          'mkdir -p ${{ github.workspace }}/app-src/output',
          'mkdir -p ${{ github.workspace }}/app-src/output/src',
          'cd ${{ github.workspace }}/app-src',
          'dotnet restore',
          'dotnet publish --configuration Release --runtime linux-arm64 --output ${{ github.workspace }}/app-src/output/src -p:PublishReadyToRun=true -p:PublishReadyToRunShowWarnings=true --self-contained',
          'cd ${{ github.workspace }}/app-src/output',
          'zip -r ${{ github.workspace }}/assets/app_arm64.zip src/',
          'cd ${{ github.workspace }}/app-src',
          'zip -r ${{ github.workspace }}/assets/app_arm64.zip scripts/ appspec.yml',
          'rm -rf ${{ github.workspace }}/app-src/output',
        ].join('\n'),
      },
      {
        name: 'Build failing arm64 web app',
        if: 'steps.should-build.outputs.skip == \'false\' && env.BUILD_APP == \'true\'',
        run: [
          'rm -rf ${{ github.workspace }}/app-src/output',
          'mkdir -p ${{ github.workspace }}/app-src/output',
          'mkdir -p ${{ github.workspace }}/app-src/output/src',
          'cd ${{ github.workspace }}/app-src',
          'dotnet publish --configuration Release --runtime linux-arm64 --output ${{ github.workspace }}/app-src/output/src -p:DefineConstants="FAIL" -p:PublishReadyToRun=true -p:PublishReadyToRunShowWarnings=true --self-contained',
          'cd ${{ github.workspace }}/app-src/output',
          'zip -r ${{ github.workspace }}/assets/app_arm64_fail.zip src/',
          'cd ${{ github.workspace }}/app-src',
          'zip -r ${{ github.workspace }}/assets/app_arm64_fail.zip scripts/ appspec.yml',
          'rm -rf ${{ github.workspace }}/app-src/output',
        ].join('\n'),
      },
      {
        name: 'Build arm64 container',
        if: 'steps.should-build.outputs.skip == \'false\'',
        run: [
          'rm -rf ${{ github.workspace }}/app-src/output',
          'mkdir -p ${{ github.workspace }}/app-src/output',
          'mkdir -p ${{ github.workspace }}/app-src/output/src',
          'cd ${{ github.workspace }}/app-src',
          'dotnet publish --configuration Release --runtime linux-musl-arm64 --output ${{ github.workspace }}/app-src/output/src -p:PublishReadyToRun=true -p:PublishReadyToRunShowWarnings=true --self-contained',
          'cd ${{ github.workspace }}/app-src/output',
          'docker build --tag $PROJECT_NAME:latest --platform linux/arm64 --build-arg SRC=src --file ${{ github.workspace }}/build/dockerfile .',
          'docker save $PROJECT_NAME:latest | gzip > ${{ github.workspace }}/assets/container.tar.gz',
          'zip -j ${{ github.workspace }}/assets/app_deploy.zip ${{ github.workspace }}/assets/container.tar.gz',
          'zip -j ${{ github.workspace }}/assets/app_deploy.zip ${{ github.workspace }}/assets/cloudwatch-agent.tar.gz',
          'cd ${{ github.workspace }}/app-src',
          'zip -r ${{ github.workspace }}/assets/app_deploy.zip docker/',
          'cd ${{ github.workspace }}/app-src/docker',
          '# Put the appspec.yml file at the root dir so it can be found, but is duplicated in the folder',
          'zip ${{ github.workspace }}/assets/app_deploy.zip appspec.yml',
          'rm -rf ${{ github.workspace }}/app-src/output',
        ].join('\n'),
      },
      {
        name: 'Build failing arm64 container',
        if: 'steps.should-build.outputs.skip == \'false\'',
        run: [
          'rm -rf ${{ github.workspace }}/app-src/output',
          'mkdir -p ${{ github.workspace }}/app-src/output',
          'mkdir -p ${{ github.workspace }}/app-src/output/src',
          'cd ${{ github.workspace }}/app-src',
          'dotnet publish --configuration Release --runtime linux-musl-arm64 --output ${{ github.workspace }}/app-src/output/src -p:DefineConstants="FAIL" -p:PublishReadyToRun=true -p:PublishReadyToRunShowWarnings=true --self-contained',
          'cd ${{ github.workspace }}/app-src/output',
          'docker build --tag $PROJECT_NAME:latest --platform linux/arm64 --build-arg SRC=src --file ${{ github.workspace }}/build/dockerfile .',
          'docker save $PROJECT_NAME:latest | gzip > /tmp/container.tar.gz',
          'zip -j ${{ github.workspace }}/assets/app_deploy_fail.zip /tmp/container.tar.gz',
          'zip -j ${{ github.workspace }}/assets/app_deploy_fail.zip ${{ github.workspace }}/assets/cloudwatch-agent.tar.gz',
          'cd ${{ github.workspace }}/app-src',
          'zip -r ${{ github.workspace }}/assets/app_deploy_fail.zip docker/',
          'cd ${{ github.workspace }}/app-src/docker',
          '# Put the appspec.yml file at the root dir so it can be found, but is duplicated in the folder',
          'zip ${{ github.workspace }}/assets/app_deploy_fail.zip appspec.yml',
          'rm -f /tmp/container.tar.gz',
          'rm -rf ${{ github.workspace }}/app-src/output',
        ].join('\n'),
      },
      {
        name: 'Build assets',
        if: 'steps.should-build.outputs.skip == \'false\'',
        run: [
          'cd ${{ github.workspace }}/$CDK_LOCATION',
          'cdk synth --quiet',
          'chmod +x ${{ github.workspace }}/build/package.py',
          '${{ github.workspace }}/build/package.py $PROJECT_NAME ${{ github.workspace }} $CDK_LOCATION',
          'cd ${{ github.workspace }}/assets',
          'zip -r ${{ github.workspace }}/content.zip .',
          'cp ${{ github.workspace }}/static/$PROJECT_NAME.json ${{ github.workspace }}/$PROJECT_NAME.template',
          'cd ${{ github.workspace }}',
          'zip ${{ github.workspace }}/content.zip $PROJECT_NAME.template',
          'cp ${{ github.workspace }}/content.zip ${{ github.workspace }}/assets',
        ].join('\n'),
      },
      {
        name: 'Upload workshop artifact',
        if: 'steps.should-build.outputs.skip == \'false\'',
        uses: 'actions/upload-artifact@v4',
        with: {
          name: 'WorkshopArtifact',
          path: [
            '${{ github.workspace }}/static',
            '${{ github.workspace }}/content',
            '${{ github.workspace }}/contentspec.yaml',
          ].join('\n'),
        },
      },
      {
        name: 'Upload assets artifact',
        if: 'steps.should-build.outputs.skip == \'false\'',
        uses: 'actions/upload-artifact@v4',
        with: {
          name: 'AssetsArtifact',
          path: '${{ github.workspace }}/assets/**/*',
        },
      },
      {
        name: 'Upload content artifact',
        if: 'steps.should-build.outputs.skip == \'false\'',
        uses: 'actions/upload-artifact@v4',
        with: {
          name: 'ContentArtifact',
          path: '${{ github.workspace }}/content.zip',
        },
      },
      {
        name: 'Save PR Number',
        if: 'steps.should-build.outputs.skip == \'false\'',
        run: 'echo "${{ github.event.pull_request.number }}" > pr_number.txt',
      },
      {
        name: 'Upload PR Number Artifact',
        if: 'steps.should-build.outputs.skip == \'false\'',
        uses: 'actions/upload-artifact@v4',
        with: {
          name: 'PullRequestNumber',
          path: 'pr_number.txt',
        },
      },
    ],
  });

  // Final job
  buildWorkflow.addJob('final', {
    permissions: {},
    needs: ['filter', 'build'],
    if: '${{ always() }}',
    runsOn: ['ubuntu-latest'],
    steps: [
      {
        name: 'Decide final outcome',
        run: [
          'echo "filter.should_run=${{ needs.filter.outputs.should_run }}"',
          'echo "build.result=${{ needs.build.result }}"',
          '',
          'if [ "${{ needs.filter.outputs.should_run }}" = "false" ]; then',
          '  echo "Only ignored paths changed; treating as success."',
          '  exit 0',
          'fi',
          '',
          'if [ "${{ needs.build.result }}" = "success" ]; then',
          '  echo "Build succeeded; treating as success."',
          '  exit 0',
          'fi',
          '',
          'echo "Build did not succeed when it should have run; failing."',
          'exit 1',
        ].join('\n'),
      },
    ],
  });

  console.log('✅ Build workflow configured');
}

console.log('✅ Root project configured');
console.log('📦 CDK tasks: cdk:build, cdk:synth, cdk:deploy');
console.log('🏗️  Build task: build:local');

project.synth();
