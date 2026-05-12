import { javascript } from 'projen';
import { AwsCdkTypeScriptApp } from 'projen/lib/awscdk';
import { GithubCredentials } from 'projen/lib/github';
import { NodePackageManager, UpgradeDependenciesSchedule } from 'projen/lib/javascript';
import { createBuildTasks, createDeployTasks, createPublishTasks } from './projenrc/tasks/';
import { createDeployWorkflow, createAutoApproveWorkflow, createPublishWorkflow, customizeReleaseWorkflow } from './projenrc/workflows';

// Root project that manages the entire multi-az-workshop monorepo
const project = new AwsCdkTypeScriptApp({
  name: 'multi-az-workshop',
  description: 'The multi-AZ resilience patterns workshop',
  defaultReleaseBranch: 'main',
  projenrcTs: true,
  cdkVersion: '2.248.0',
  cdkVersionPinning: true,
  constructsVersion: '10.5.0',
  appEntrypoint: 'cdk/multi-az-workshop.ts',
  srcdir: 'src',
  packageManager: NodePackageManager.YARN_BERRY,
  yarnBerryOptions: {
    yarnRcOptions: {
      nodeLinker: javascript.YarnNodeLinker.NODE_MODULES,
    },
  },

  // TypeScript compiler options
  tsconfig: {
    compilerOptions: {
      isolatedModules: true,
    },
  },
  tsconfigDev: {
    compilerOptions: {
      isolatedModules: true,
    },
  },

  // Project metadata
  authorName: 'Michael Haken',
  authorEmail: 'mhaken@amazon.com',
  homepage: 'https://github.com/awslabs/multi-az-workshop',
  repository: 'https://github.com/awslabs/multi-az-workshop',
  license: 'Apache-2.0',

  // Enable default build workflow with custom configuration
  workflowRunsOn: ['ubuntu-24.04-arm'],
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
    // mutableBuild=true causes the build workflow to automatically commit any
    // file mutations (e.g. from eslint --fix, projen regeneration) back to the
    // PR branch and re-trigger the build, rather than failing it outright.
    mutableBuild: true,
  },
  release: true,

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
    mergify: false,
    mergeQueue: true,
    mergeQueueOptions: {
      autoQueueOptions: {
        allowedUsernames: ['hakenmt', 'github-actions[bot]'],
        labels: ['auto-approve', 'auto-merge'],
      },
    },
    // Use a PAT for projen-driven operations (self-mutation pushes, dep
    // upgrades, auto-queue). The default GITHUB_TOKEN cannot trigger downstream
    // workflows, which would prevent the build from re-running after a
    // self-mutation push.
    projenCredentials: GithubCredentials.fromPersonalAccessToken({
      secret: 'PROJEN_GITHUB_TOKEN',
    }),
  },

  // Minimal dependencies for root project
  devDeps: [
    '@types/node',
    '@cdklabs/multi-az-observability@0.0.1-alpha.60',
    '@aws-cdk/lambda-layer-kubectl-v35@^2.0.0',
    'fast-check@^3.15.0',
  ],
  deps: [],
  peerDeps: [],

  // ESLint configuration
  eslintOptions: {
    dirs: ['src', 'test'],
    devdirs: ['src/cdk', 'test', 'build-tools', '.projenrc.ts', 'projenrc'],
    ignorePatterns: ['*.d.ts', '*.js', 'node_modules/', 'lib/'],
  },

  gitignore: [
    '*.d.ts',
    'node_modules/',
    '/lib/',
    'coverage/',
    'test-reports/',
    '.DS_Store',
    '**/.DS_Store',
    'tsconfig.tsbuildinfo',

    // IDE
    '.kiro/',

    // CDK specific
    'static/multi-az-workshop.json',
    'cdk.out*/',

    // Build artifacts
    'src/app/bin',
    'src/app/obj',
    'src/app/output/',

    'assets/',
    'tmp/',
    'dist/',

    // Test artifacts
    'test/app/bin',
    'test/app/TestResults',
    'test/app/obj',
    'test/cdk/__snapshots__/',
  ],
});

// Pin minimum transitive dependency versions for security patches
project.package.addPackageResolutions(
  'flatted@>=3.4.2',
  'fast-xml-parser@>=5.7.0',
  'fast-xml-builder@>=1.2.0',
  'fast-uri@>=3.1.2',
  'handlebars@>=4.7.9',
  'picomatch@>=2.3.2',
  'uuid@>=14.0.0',
);

// projen's AutoQueue only triggers on opened/reopened/ready_for_review by default,
// which means adding an auto-approve/auto-merge label to an existing PR won't enable
// auto-queue. Add 'labeled' so post-creation labeling works like it did under Mergify.
const autoQueueWorkflow = project.github?.tryFindWorkflow('auto-queue');
if (autoQueueWorkflow?.file) {
  autoQueueWorkflow.file.addOverride('on.pull_request_target.types', [
    'opened',
    'reopened',
    'ready_for_review',
    'labeled',
  ]);
}

// After a successful PR build, upload dist/content.zip as an artifact so the
// privileged deploy workflow can consume it via workflow_run without ever
// checking out untrusted PR code.
project.buildWorkflow?.addPostBuildSteps({
  name: 'Upload content artifact',
  if: "github.event_name == 'pull_request'",
  uses: 'actions/upload-artifact@v7',
  with: {
    'name': 'workshop-content',
    'path': 'dist/content.zip',
    'retention-days': 7,
    'if-no-files-found': 'error',
  },
});

// Add global environment variables for all tasks
project.tasks.addEnvironment('PROJECT_NAME', project.name);

// Create workflows using externalized modules
createDeployWorkflow(project.github!);
createAutoApproveWorkflow(project.github!);
createPublishWorkflow(project.github!);
customizeReleaseWorkflow(project);

// Create tasks using externalized modules
createBuildTasks(project);
createDeployTasks(project);
createPublishTasks(project);

project.synth();
