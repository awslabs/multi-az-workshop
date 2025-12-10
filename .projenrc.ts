import { AwsCdkTypeScriptApp } from 'projen/lib/awscdk';
import { UpgradeDependenciesSchedule } from 'projen/lib/javascript';
import { createBuildTasks, createDeployTasks, createPublishTasks } from './projenrc/tasks/';
import { customizeBuildWorkflow, createDeployWorkflow, createAutoApproveWorkflow, createPublishWorkflow, customizeReleaseWorkflow } from './projenrc/workflows';

// Root project that manages the entire multi-az-workshop monorepo
const project = new AwsCdkTypeScriptApp({
  name: 'multi-az-workshop',
  description: 'The multi-AZ resilience patterns workshop',
  defaultReleaseBranch: 'main',
  projenrcTs: true,
  cdkVersion: '2.227.0',
  appEntrypoint: 'cdk/multi-az-workshop.ts',
  srcdir: 'src',

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
    mutableBuild: false,
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
    mergify: true,
  },

  // Minimal dependencies for root project
  devDeps: [
    '@types/node',
    '@cdklabs/multi-az-observability@0.0.1-alpha.60',
    '@aws-cdk/lambda-layer-kubectl-v31@^2.0.0',
    'fast-check@^3.15.0',
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
    '/lib/',
    'coverage/',
    'test-reports/',
    '.DS_Store',
    '**/.DS_Store',
    'tsconfig.tsbuildinfo',

    // IDE
    '.kiro/',

    // CDK specific
    'cdk.out/',

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

// Add global environment variables for all tasks
project.tasks.addEnvironment('PROJECT_NAME', project.name);

// Create workflows using externalized modules
customizeBuildWorkflow(project);
createDeployWorkflow(project.github!);
createAutoApproveWorkflow(project.github!);
createPublishWorkflow(project.github!);
customizeReleaseWorkflow(project);

// Create tasks using externalized modules
createBuildTasks(project);
createDeployTasks(project);
createPublishTasks(project);

project.synth();
