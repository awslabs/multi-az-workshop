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

    // Test artifacts
    'test/app/bin',
    'test/app/TestResults',
    'test/app/obj'

  ],
});

// Add global environment variables for all tasks
project.tasks.addEnvironment('PROJECT_NAME', project.name);

// Builds the web app
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

// .NET test tasks
const testAppUnit = project.addTask('test:app:unit', {
  description: 'Run .NET unit tests',
  exec: 'dotnet test test/app/Unit --configuration Release --logger "console;verbosity=detailed"',
});

const testAppIntegration = project.addTask('test:app:integration', {
  description: 'Run .NET integration tests',
  exec: 'dotnet test test/app/Integration --configuration Release --logger "console;verbosity=detailed"',
});

// Add .NET tests to main test task
const test = project.tasks.tryFind('test');
if (test) {
  test.spawn(testAppUnit);
  test.spawn(testAppIntegration);
}

// Create deploy workflow
const deployWorkflow = new GithubWorkflow(project.github!, 'deploy');
deployWorkflow.on({
  push: {
    branches: ['main'],
  }
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
      run: `
        if [ "\${{ github.event_name }}" == "workflow_dispatch" ]; then
          echo "Manual trigger - will deploy"
          echo "should_deploy=true" >> $GITHUB_OUTPUT
        elif git diff --name-only HEAD^ HEAD | grep -q "^src/"; then
          echo "Changes detected in src/ - will deploy"
          echo "should_deploy=true" >> $GITHUB_OUTPUT
        else
          echo "No changes in src/ - skipping deployment"
          echo "should_deploy=false" >> $GITHUB_OUTPUT
        fi
      `.trim()
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
      run: `
        DEPLOYMENT_ID=$(gh api repos/\${{ github.repository }}/deployments \\
          -f ref=\${{ github.sha }} \\
          -f environment=AWS \\
          -F auto_merge=false \\
          --jq '.id')
        echo "deployment_id=$DEPLOYMENT_ID" >> $GITHUB_OUTPUT
        echo "Created deployment: $DEPLOYMENT_ID"
      `.trim()
    },
  ],
});

// Job 3: Bundle and deploy
deployWorkflow.addJob('bundle-and-deploy', {
  needs: ['check-changes', 'create-deployment'],
  if: 'needs.check-changes.outputs.should_deploy == \'true\'',
  runsOn: ['ubuntu-24.04-arm'],
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
      run: `
        if [ "\${{ needs.bundle-and-deploy.result }}" == "success" ]; then
          STATE="success"
        else
          STATE="failure"
        fi
        gh api repos/\${{ github.repository }}/deployments/\${{ needs.create-deployment.outputs.deployment_id }}/statuses \\
          -f state=$STATE
        echo "Deployment status: $STATE"
      `.trim()
    },
  ],
});

// Auto-approve workflow
const autoApproveWorkflow = new GithubWorkflow(project.github!, 'auto-approve');
autoApproveWorkflow.on({
  pullRequest: {
    types: [
      'labeled',
      'opened',
      'synchronize',
      'reopened',
      'ready_for_review',
    ],
  },
});

autoApproveWorkflow.addJob('approve', {
  runsOn: ['ubuntu-latest'],
  permissions: {
    pullRequests: JobPermission.WRITE,
    actions: JobPermission.READ,
    checks: JobPermission.READ,
  },
  if: `contains(github.event.pull_request.labels.*.name, 'auto-approve') && contains('${AUTHORIZED_APPROVERS.join(',')}', github.event.pull_request.user.login)`,
  env: {
    SHA: '${{ github.event.pull_request.head.sha }}',
    GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
    TIMEOUT: '600',
    INTERVAL: '10',
    WORKFLOW_NAME: 'build',
    TERMINATING_STATUS: 'completed,action_required,cancelled,failure,neutral,skipped,stale,success,timed_out',
  },
  steps: [
    {
      name: 'Wait for Build to Complete',
      id: 'wait-for-build',
      run: `
        START_TIME=$(date +%s)

        while true; do
          # Fetch latest workflow run matching SHA and workflow name
          WORKFLOW_RUN=$(gh api /repos/\${{ github.repository }}/actions/runs \\
          --jq ".workflow_runs | map(select(.head_sha == \\"$SHA\\" and .name == \\"$WORKFLOW_NAME\\")) | first")
          
          if [ -z "$WORKFLOW_RUN" ]; then
            echo "No build workflow run found for commit $SHA."
            echo "conclusion=success" >> "$GITHUB_OUTPUT"
            break
          else
            STATUS=$(echo "$WORKFLOW_RUN" | jq -r '.conclusion')
            RUN_NUMBER=$(echo "$WORKFLOW_RUN" | jq -r '.run_number')
            RUN_ID=$(echo "$WORKFLOW_RUN" | jq -r '.id')
            RUN_ATTEMPT=$(echo "$WORKFLOW_RUN" | jq -r '.run_attempt')
            WORKFLOW_ID=$(echo "$WORKFLOW_RUN" | jq -r '.workflow_id')

            echo "Build SHA: $SHA"
            echo "Build workflow run: $RUN_ID"
            echo "Build workflow status: $STATUS"

            if [[ ",$TERMINATING_STATUS," == *",$STATUS,"* ]]; then
              echo "Build workflow finished with conclusion: $STATUS"
              echo "conclusion=$STATUS" >> "$GITHUB_OUTPUT"
              break
            fi
          fi

          # Check if timeout has been reached
          ELAPSED=$(( $(date +%s) - START_TIME ))
          if [ $ELAPSED -ge $TIMEOUT ]; then
            echo "Timeout reached. Build workflow did not succeed within $TIMEOUT seconds."
            echo "conclusion=timed_out" >> "$GITHUB_OUTPUT"
            break
          fi

          sleep $INTERVAL
        done
      `.trim(),
    },
    {
      name: 'Wait for Required Checks to Complete',
      id: 'wait-for-required-checks',
      run: `
        START_TIME=$(date +%s)

        SELF_JOB_NAME="approve"

        while true; do
          echo "🔍 Checking status of check runs for $SHA"

          CHECK_RUNS=$(gh api repos/\${{ github.repository }}/commits/$SHA/check-runs --paginate \\
            --jq '[.check_runs[] | select(.name != "'"$SELF_JOB_NAME"'")]')

          echo "📋 All check run statuses:"
          echo "$CHECK_RUNS" | jq -r '.[] | "- \\(.name): \\(.status) / \\(.conclusion)"'

          FAILED=$(echo "$CHECK_RUNS" | jq '[.[] | select(.conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out")] | length')
          PENDING=$(echo "$CHECK_RUNS" | jq '[.[] | select(.status != "completed")] | length')

          echo "Pending checks (excluding this job): $PENDING"
          echo "Failed checks: $FAILED"

          if [ "$FAILED" -gt 0 ]; then
            echo "❌ One or more required checks failed."
            echo "conclusion=failure" >> "$GITHUB_OUTPUT"
            break
          fi

          if [ "$PENDING" -eq 0 ]; then
            echo "✅ All required checks (excluding this job) have completed successfully."
            echo "conclusion=success" >> "$GITHUB_OUTPUT"
            break
          else
            echo "⏳ Still waiting on the following checks:"
            echo "$PENDING_CHECKS" | jq -r '.[] | "- \\(.name): \\(.status)"'
          fi

          ELAPSED=$(( $(date +%s) - START_TIME ))
          if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
            echo "⏰ Timeout reached while waiting for checks."
            echo "conclusion=timed_out" >> "$GITHUB_OUTPUT"
            break
          fi

          sleep $INTERVAL
        done
      `.trim(),
    },
    {
      name: 'Fail If Checks or Build Failed',
      id: 'fail',
      if: `steps.wait-for-build.outputs.conclusion != 'success' ||
steps.wait-for-required-checks.outputs.conclusion != 'success'`,
      run: `
        echo "❌ Build or required checks did not succeed."
        echo "Build status: \${{ steps.wait-for-build.outputs.conclusion }}"
        echo "Checks status: \${{ steps.wait-for-required-checks.outputs.conclusion }}"
        exit 1
      `.trim(),
    },
    {
      name: 'Auto-Approve PR',
      id: 'auto-approve',
      uses: 'hmarr/auto-approve-action@v2.2.1',
      if: `contains('success,neutral,skipped', steps.wait-for-build.outputs.conclusion)`,
      with: {
        'github-token': '${{ secrets.GITHUB_TOKEN }}',
      },
    },
  ],
});

// Release workflow
const releaseWorkflow = new GithubWorkflow(project.github!, 'release');
releaseWorkflow.on({
  workflowDispatch: {
    inputs: {
      aws_access_key_id: {
        type: 'string',
        description: 'The access key id',
      },
      aws_secret_access_key: {
        type: 'string',
        description: 'The secret access key',
      },
      aws_session_token: {
        type: 'string',
        description: 'The session token',
      },
      email: {
        type: 'string',
        description: 'The email used for the git commit',
      },
      prerelease: {
        type: 'string',
        description: "If you want to make this a pre-release specify the value like 'alpha' or 'beta'",
      },
    },
  },
});

// Add workflow-level environment variables
if (releaseWorkflow.file) {
  releaseWorkflow.file.addOverride('env', {
    AWS_DEFAULT_REGION: 'us-east-1',
    WS_REPO_SOURCE: 's3',
    AWS_ACCESS_KEY_ID: '${{ inputs.aws_access_key_id }}',
    AWS_SECRET_ACCESS_KEY: '${{ inputs.aws_secret_access_key }}',
    AWS_SESSION_TOKEN: '${{ inputs.aws_session_token }}',
    WORKSHOP_ID: 'e9383b42-6c6f-416b-b50a-9313e476e372',
    USER_NAME: '${{ github.triggering_actor }}',
    EMAIL: '${{ inputs.email }}',
    REMOTE_REPO: 'advanced-multi-az-resilience-patterns',
    GH_TOKEN: '${{ github.token }}',
  });
}

// Job 1: Build workshop content once
releaseWorkflow.addJob('build', {
  runsOn: ['ubuntu-24.04-arm'],
  permissions: {
    contents: JobPermission.READ,
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
      name: 'Bundle workshop',
      run: 'npx projen bundle:workshop',
    },
    {
      name: 'Extract assets from content.zip',
      run: 'npx projen release:extract-assets',
    },
    {
      name: 'Upload assets artifact',
      uses: 'actions/upload-artifact@v4',
      with: {
        name: 'workshop-assets',
        path: 'tmp/assets',
        'retention-days': 1,
      },
    },
    {
      name: 'Upload workshop content artifact',
      uses: 'actions/upload-artifact@v4',
      with: {
        name: 'workshop-content',
        path: `content
static
contentspec.yaml`,
        'retention-days': 1,
      },
    },
    {
      name: 'Upload content.zip artifact',
      uses: 'actions/upload-artifact@v4',
      with: {
        name: 'content-zip',
        path: 'assets/content.zip',
        'retention-days': 1,
      },
    },
  ],
});

// Job 2: Upload assets to S3
releaseWorkflow.addJob('assets', {
  needs: ['build'],
  runsOn: ['ubuntu-latest'],
  permissions: {
    contents: JobPermission.READ,
  },
  steps: [
    {
      name: 'Download assets artifact',
      uses: 'actions/download-artifact@v4',
      with: {
        name: 'workshop-assets',
        path: '${{ github.workspace }}/assets',
      },
    },
    {
      name: 'Upload assets to S3',
      run: 'aws s3 sync ${{ github.workspace }}/assets s3://ws-assets-us-east-1/$WORKSHOP_ID --delete',
    },
  ],
});

// Job 3: Push workshop content to WorkshopStudio
releaseWorkflow.addJob('workshop', {
  needs: ['build', 'assets'],
  runsOn: ['ubuntu-latest'],
  permissions: {
    contents: JobPermission.READ,
  },
  steps: [
    {
      name: 'Download workshop content artifact',
      uses: 'actions/download-artifact@v4',
      with: {
        name: 'workshop-content',
        path: '${{ github.workspace }}/workshop',
      },
    },
    {
      name: 'Install git-remote-workshopstudio',
      run: `
        pip config set global.trusted-host plugin.us-east-1.prod.workshops.aws
pip config set global.extra-index-url https://plugin.us-east-1.prod.workshops.aws
pipx install git-remote-workshopstudio
git config --global user.email $EMAIL
git config --global user.name "$USER_NAME"
      `.trim(),
    },
    {
      name: 'Push workshop content',
      run: `
        git clone --branch mainline workshopstudio://ws-content-$WORKSHOP_ID/$REMOTE_REPO \${{ github.workspace }}/$REMOTE_REPO
cd \${{ github.workspace }}/$REMOTE_REPO
find . -path ./.git -prune -o ! -name . ! -name .. -exec rm -rf {} + 2> /dev/null
cp -r \${{ github.workspace }}/workshop/. \${{ github.workspace }}/$REMOTE_REPO
# exits 1 if there are changes, which is interpreted as true
set +e
git diff --quiet
if [ $? -eq 1 ]; then
  set -e
  git add -A
  git commit -m "New workshop version"
  git push
else
  echo "No changes detected, nothing to commit"
fi
      `.trim(),
    },
  ],
});

// Job 4: Create GitHub release
releaseWorkflow.addJob('release', {
  needs: ['build', 'assets', 'workshop'],
  runsOn: ['ubuntu-latest'],
  permissions: {
    contents: JobPermission.WRITE,
  },
  steps: [
    {
      name: 'Download content.zip artifact',
      uses: 'actions/download-artifact@v4',
      with: {
        name: 'content-zip',
        path: '.',
      },
    },
    {
      name: 'Determine version bump',
      id: 'version',
      run: 'npx projen release:determine-version',
      env: {
        PRERELEASE_INPUT: '${{ inputs.prerelease }}',
      },
    },
    {
      name: 'Create Git tag',
      run: `
        git tag \${{ env.BUMPED_VERSION }}
        git push origin \${{ env.BUMPED_VERSION }}
      `.trim(),
    },
    {
      name: 'Create GitHub release',
      run: `
        if [[ -n "\${{ inputs.prerelease }}" ]]; then
  gh release create \${{ env.BUMPED_VERSION }} --title "\${{ env.BUMPED_VERSION }}" --prerelease --verify-tag content.zip
else
  gh release create \${{ env.BUMPED_VERSION }} --title "\${{ env.BUMPED_VERSION }}" --verify-tag content.zip
fi
      `.trim(),
    },
  ],
});

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

const packageAssets = project.addTask('assets:package', {
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

// Combined build-assets task that runs all asset building tasks in order
const buildAssets = project.addTask('build:assets', {
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

// Bundle task - build assets, synth cdk, process cdk assets, and package
const bundleWorkshop = project.addTask('bundle:workshop', {
  description: 'Bundle all workshop content for deployment',
});

bundleWorkshop.say("Building workshop assets...");
bundleWorkshop.spawn(buildAssets);
bundleWorkshop.say("Synthesizing CDK stacks...");
bundleWorkshop.spawn(project.tasks.tryFind("synth:silent")!);
bundleWorkshop.say("Processing CDK assets...");
bundleWorkshop.spawn(processCdkAssets);
bundleWorkshop.say("Packaging assets...");
bundleWorkshop.spawn(packageAssets);

// Deploy task - unzip content, upload to S3, create and execute changeset with proper cleanup
project.addTask('deploy:workshop', {
  description: 'Deploy workshop to AWS using CloudFormation',
  steps: [
    {
      say: 'Preparing deployment...',
    },
    {
      exec: 'rm -rf tmp && mkdir -p tmp',
    },
    {
      exec: 'unzip -q assets/content.zip -d tmp',
    },
    {
      say: 'Setting deployment timestamp...',
    },
    {
      exec: 'date --utc +"%Y-%m-%dT%H-%M-%SZ" > tmp/assets_prefix.txt',
    },
    {
      say: 'Uploading assets to S3...',
    },
    {
      exec: 'aws s3 cp tmp s3://${BUCKET}/$(cat tmp/assets_prefix.txt)/ --recursive',
    },
    {
      say: 'Determining stack status...',
    },
    {
      exec: `
        set +e
        aws cloudformation describe-stacks --stack-name $PROJECT_NAME --region $AWS_REGION >/dev/null 2>&1
        EXITCODE=$?
        set -e

        if [[ $EXITCODE -eq 0 ]]; then
          echo "UPDATE" > tmp/change_set_type.txt
          echo "update" > tmp/wait_condition.txt
          echo "Stack exists - will UPDATE"
        else
          echo "CREATE" > tmp/change_set_type.txt
          echo "create" > tmp/wait_condition.txt
          echo "Stack does not exist - will CREATE"
        fi
      `.trim()
    },
    {
      say: 'Deploying CloudFormation stack...',
    },
    {
      exec: `
        # Load variables from files
        ASSETS_PREFIX=$(cat tmp/assets_prefix.txt)
        CHANGE_SET_TYPE=$(cat tmp/change_set_type.txt)
        WAIT_CONDITION=$(cat tmp/wait_condition.txt)

        # Trap to handle cleanup on failure
        cleanup_on_failure() {
          echo "Deployment failed - cleaning up new S3 content"
          aws s3 rm s3://$BUCKET/ --recursive --exclude "*" --include "$ASSETS_PREFIX/*"
          exit 1
        }
        trap cleanup_on_failure ERR

        # Create changeset
        aws cloudformation create-change-set \\
          --change-set-type $CHANGE_SET_TYPE \\
          --stack-name $PROJECT_NAME \\
          --change-set-name $PROJECT_NAME-$ASSETS_PREFIX \\
          --template-url https://$BUCKET.s3.$AWS_REGION.amazonaws.com/$ASSETS_PREFIX/$PROJECT_NAME.json \\
          --parameters \\
            ParameterKey=AssetsBucketName,ParameterValue=$BUCKET \\
            ParameterKey=AssetsBucketPrefix,ParameterValue="$ASSETS_PREFIX/" \\
          --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \\
          --region $AWS_REGION

        # Wait for changeset creation
        aws cloudformation wait change-set-create-complete \\
          --stack-name $PROJECT_NAME \\
          --change-set-name $PROJECT_NAME-$ASSETS_PREFIX \\
          --region $AWS_REGION

        # Execute changeset
        aws cloudformation execute-change-set \\
          --stack-name $PROJECT_NAME \\
          --change-set-name $PROJECT_NAME-$ASSETS_PREFIX \\
          --region $AWS_REGION

        # Wait for stack completion
        aws cloudformation wait stack-$WAIT_CONDITION-complete \\
          --stack-name $PROJECT_NAME \\
          --region $AWS_REGION

        # Remove trap after successful deployment
        trap - ERR
      `.trim()
    },
    {
      say: 'Deployment succeeded!',
    },
    {
      exec: `
        ASSETS_PREFIX=$(cat tmp/assets_prefix.txt)
        echo "Cleaning up old S3 content due to successful deployment"
        aws s3 rm s3://$BUCKET/ --recursive --exclude "$ASSETS_PREFIX/*"
      `.trim()
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
      spawn: 'bundle:workshop',
    },
    {
      spawn: 'deploy:workshop',
    },
  ],
});

// Release tasks
project.addTask('release:extract-assets', {
  description: 'Extract assets from content.zip for release',
  steps: [
    {
      exec: 'rm -rf tmp/assets && mkdir -p tmp/assets',
    },
    {
      exec: 'unzip -q assets/content.zip -d tmp/assets',
    },
  ],
});

project.addTask('release:determine-version', {
  description: 'Determine the next version for release',
  steps: [
    {
      exec: `
        # Get latest release tag
        latest_tag=$(gh release list --limit 1 --json tagName --jq '.[0].tagName')
        
        if [ -z "$latest_tag" ]; then
          echo "No release found. Starting with v0.0.0."
          latest_tag="v0.0.0"
        else
          echo "Latest release tag: $latest_tag"
        fi
        
        # Determine bump type (always patch for now)
        bump_type="patch"
        echo "Detected bump type: $bump_type"
        
        # Extract version numbers
        tag="\${latest_tag//v/}"
        regex='^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-((0|[1-9A-Za-z-][0-9A-Za-z-]*)(\\.(0|[1-9A-Za-z-][0-9A-Za-z-]*))*))?(\\+([0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*))?$'
        
        if [[ "$tag" =~ $regex ]]; then
          major="\${BASH_REMATCH[1]}"
          minor="\${BASH_REMATCH[2]}"
          patch="\${BASH_REMATCH[3]}"
          prerelease="\${BASH_REMATCH[5]}"
          
          echo "MAJOR: $major"
          echo "MINOR: $minor"
          echo "PATCH: $patch"
          echo "PRE-RELEASE: $prerelease"
          
          # Bump version based on bump type
          case "$bump_type" in
            major)
              major=$((major + 1))
              minor=0
              patch=0
              if [ -n "$PRERELEASE_INPUT" ]; then
                prerelease="\${PRERELEASE_INPUT}.1"
              else
                prerelease=""
              fi
              ;;
            minor)
              minor=$((minor + 1))
              patch=0
              if [ -n "$PRERELEASE_INPUT" ]; then
                prerelease="\${PRERELEASE_INPUT}.1"
              else
                prerelease=""
              fi
              ;;
            patch)
              if [ -n "$PRERELEASE_INPUT" ]; then
                prerelease_parts=(\${prerelease//./ })
                prerelease_label_in_tag="\${prerelease_parts[0]}"
                prerelease_version_number="\${prerelease_parts[1]}"
                
                if [[ "$PRERELEASE_INPUT" != "$prerelease_label_in_tag" ]]; then
                  echo "Pre-release label mismatch. Resetting pre-release version."
                  prerelease="\${PRERELEASE_INPUT}.1"
                else
                  echo "Pre-release labels match, incrementing patch version."
                  prerelease_version_number=$((prerelease_version_number + 1))
                  prerelease="\${PRERELEASE_INPUT}.\${prerelease_version_number}"
                fi
              else
                if [ -z "$prerelease" ]; then
                  patch=$((patch + 1))
                else
                  prerelease=""
                fi
              fi
              ;;
          esac
          
          # Create new version tag
          if [ -n "$prerelease" ]; then
            bumped_version="v$major.$minor.$patch-$prerelease"
          else
            bumped_version="v$major.$minor.$patch"
          fi
          
          echo "Bumped version to: $bumped_version"
          echo "BUMPED_VERSION=$bumped_version" >> $GITHUB_ENV
        else
          echo "Tag $tag is invalid, resetting version to v0.0.1"
          bumped_version="v0.0.1"
          echo "BUMPED_VERSION=$bumped_version" >> $GITHUB_ENV
        fi
      `.trim(),
    },
  ],
});

project.synth();
