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
        uses: 'actions/setup-dotnet@67a3573c9a986a3f9c594539f4ab511d57bb3ce9', // v4
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
        allowedUsernames: ['hakenmt', 'github-actions[bot]', 'dependabot[bot]'],
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
  uses: 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a', // v7
  with: {
    'name': 'workshop-content',
    'path': 'dist/content.zip',
    'retention-days': 7,
    'if-no-files-found': 'error',
  },
});

// Harden build workflow: immutable checkout ref (head.sha not head.ref),
// concurrency group to cancel stale runs, and pin action SHAs.
const buildWorkflow = project.github?.tryFindWorkflow('build');
if (buildWorkflow?.file) {
  // Add concurrency group with cancel-in-progress to prevent TOCTOU races
  buildWorkflow.file.addOverride('concurrency', {
    'group': 'build-${{ github.event.pull_request.number || github.ref }}',
    'cancel-in-progress': true,
  });
  // Use immutable head.sha instead of mutable head.ref for checkout
  buildWorkflow.file.addOverride('jobs.build.steps.0.with.ref', '${{ github.event.pull_request.head.sha }}');
  // Pin actions to SHAs
  buildWorkflow.file.addOverride('jobs.build.steps.0.uses', 'actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10'); // v6
  buildWorkflow.file.addOverride('jobs.self-mutation.steps.0.uses', 'actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10'); // v6
  buildWorkflow.file.addOverride('jobs.self-mutation.steps.1.uses', 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c'); // v8
  // Pin the Upload patch step (projen-generated, index 7 in build job)
  buildWorkflow.file.addOverride('jobs.build.steps.7.uses', 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'); // v7
}

// Pin action SHAs in remaining projen-managed workflows
const releaseWorkflow = project.github?.tryFindWorkflow('release');
if (releaseWorkflow?.file) {
  releaseWorkflow.file.addOverride('jobs.release.steps.0.uses', 'actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10'); // v6
  releaseWorkflow.file.addOverride('jobs.release.steps.8.uses', 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'); // v7
  releaseWorkflow.file.addOverride('jobs.release_github.steps.0.uses', 'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e'); // v6
  releaseWorkflow.file.addOverride('jobs.release_github.steps.1.uses', 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c'); // v8
}
const upgradeWorkflow = project.github?.tryFindWorkflow('upgrade-main');
if (upgradeWorkflow?.file) {
  upgradeWorkflow.file.addOverride('jobs.upgrade.steps.0.uses', 'actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10'); // v6
  upgradeWorkflow.file.addOverride('jobs.upgrade.steps.5.uses', 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'); // v7
  upgradeWorkflow.file.addOverride('jobs.pr.steps.0.uses', 'actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10'); // v6
  upgradeWorkflow.file.addOverride('jobs.pr.steps.1.uses', 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c'); // v8
  upgradeWorkflow.file.addOverride('jobs.pr.steps.4.uses', 'peter-evans/create-pull-request@5f6978faf089d4d20b00c7766989d076bb2fc7f1'); // v8
}
const autoQueueWorkflowRef = project.github?.tryFindWorkflow('auto-queue');
if (autoQueueWorkflowRef?.file) {
  autoQueueWorkflowRef.file.addOverride('jobs.enableAutoQueue.steps.0.uses', 'peter-evans/enable-pull-request-automerge@a660677d5469627102a1c1e11409dd063606628d'); // v3
}
const prLintWorkflow = project.github?.tryFindWorkflow('pull-request-lint');
if (prLintWorkflow?.file) {
  prLintWorkflow.file.addOverride('jobs.validate.steps.0.uses', 'amannn/action-semantic-pull-request@48f256284bd46cdaab1048c3721360e808335d50'); // v6
}

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
