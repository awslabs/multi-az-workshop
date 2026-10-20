import { javascript, TaskShell } from 'projen';
import { AwsCdkTypeScriptApp } from 'projen/lib/awscdk';
import { GithubCredentials } from 'projen/lib/github';
import { AppPermission } from 'projen/lib/github/workflows-model';
import { NodePackageManager, UpgradeDependenciesSchedule } from 'projen/lib/javascript';
import { createBuildTasks, createDeployTasks, createPublishTasks } from './projenrc/tasks/';
import { createDeployWorkflow, createPublishWorkflow, customizeReleaseWorkflow } from './projenrc/workflows';

// Root project that manages the entire multi-az-workshop monorepo
const project = new AwsCdkTypeScriptApp({
  name: 'multi-az-workshop',
  description: 'The multi-AZ resilience patterns workshop',
  defaultReleaseBranch: 'main',
  projenrcTs: true,
  cdkVersion: '2.260.0',
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
    // projen >=0.103 no longer applies `workflowRunsOn` to the build workflow;
    // set the build (and self-mutation) job runner explicitly so the arm64
    // container build does not fall back to an x64 runner (ubuntu-latest),
    // which fails with "exec /bin/sh: exec format error".
    runsOn: ['ubuntu-24.04-arm'],
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

  // Native projen auto-approve. Approves PRs that carry the 'auto-approve'
  // label and are authored by a trusted account. Uses the pull_request_target
  // event (see projen's AutoApprove) so the GITHUB_TOKEN has write permission
  // even on Dependabot PRs, unlike the previous hand-rolled auto-approve
  // workflow which ran on `pull_request` and could not approve bot PRs.
  autoApproveOptions: {
    allowedUsernames: ['hakenmt', 'aws-cre-automation-mhaken[bot]', 'github-actions[bot]', 'dependabot[bot]'],
    label: 'auto-approve',
  },

  // GitHub settings
  githubOptions: {
    mergify: false,
    mergeQueue: true,
    mergeQueueOptions: {
      autoQueueOptions: {
        allowedUsernames: ['hakenmt', 'aws-cre-automation-mhaken[bot]', 'github-actions[bot]', 'dependabot[bot]'],
        labels: ['auto-approve', 'auto-merge'],
      },
    },
    // projen-driven operations (self-mutation pushes, dependency-upgrade PRs,
    // auto-queue's auto-merge) use the aws-cre-automation-mhaken GitHub App. The
    // default GITHUB_TOKEN can't: what it pushes, opens or merges starts no
    // other workflow, so the build would never re-run after a self-mutation
    // push and an upgrade PR would never build. The App's token is minted per
    // run, lasts an hour, reaches only the repositories the App is installed
    // on, and is limited here to what these jobs do. Its PRs are authored by
    // aws-cre-automation-mhaken[bot], trusted by auto-approve and auto-queue above.
    // Secrets: PROJEN_APP_ID, PROJEN_APP_PRIVATE_KEY.
    projenCredentials: GithubCredentials.fromApp({
      permissions: {
        contents: AppPermission.WRITE,
        pullRequests: AppPermission.WRITE,
        workflows: AppPermission.WRITE,
      },
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

    // Local-only facilitator notes (not part of published workshop content)
    'FACILITATOR_GUIDE.md',

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
  'fast-uri@>=4.1.2',
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

// Pin every action projen's own workflows use that it doesn't already pin to a commit. Done
// through projen's actions provider, which rewrites each `uses:` wherever it appears, rather than
// per-step overrides by position: projen inserts steps (the GitHub App's "Generate token" step),
// and a positional override then lands on the wrong step. Each override names the exact version
// projen uses, so actions the repo's own workflows pin are left alone.
project.github?.actions.set('actions/create-github-app-token@v3.2.0', 'actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1');
project.github?.actions.set('actions/setup-node@v7.0.0', 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020');
project.github?.actions.set('peter-evans/create-pull-request@v8.1.1', 'peter-evans/create-pull-request@5f6978faf089d4d20b00c7766989d076bb2fc7f1');

// Harden build workflow: immutable checkout ref (head.sha not head.ref) and a
// concurrency group to cancel stale runs.
const buildWorkflow = project.github?.tryFindWorkflow('build');
if (buildWorkflow?.file) {
  // Add concurrency group with cancel-in-progress to prevent TOCTOU races
  buildWorkflow.file.addOverride('concurrency', {
    'group': 'build-${{ github.event.pull_request.number || github.ref }}',
    'cancel-in-progress': true,
  });
  // Use immutable head.sha instead of mutable head.ref for checkout
  buildWorkflow.file.addOverride('jobs.build.steps.0.with.ref', '${{ github.event.pull_request.head.sha }}');
}

// NOTE: auto-queue's merge step is intentionally left as projen generates it.
// projen's AutoQueue emits a valid single `run: gh pr merge --auto` step
// (authenticated with the projenCredentials PAT). A previous override added a
// `uses:` key on top of that `run:` step, producing a step with BOTH keys — an
// invalid workflow that GitHub refused to run, so auto-merge was never enabled.
// Do not re-introduce a `.../steps.0.uses` override here.
const prLintWorkflow = project.github?.tryFindWorkflow('pull-request-lint');
if (prLintWorkflow?.file) {
  prLintWorkflow.file.addOverride('jobs.validate.steps.0.uses', 'amannn/action-semantic-pull-request@48f256284bd46cdaab1048c3721360e808335d50'); // v6
}

// projen >=0.101 runs every task command through its built-in cross-platform
// shell (dax) on all platforms, replacing the system shell used previously.
// dax does not implement `eval`, `for` loops, or the `[ ... ]` test, all of
// which the asset-building tasks rely on (e.g. `eval "$(node build/load-versions.js)"`,
// `for chart in ...; do ...; done`, `[ -f ... ] && cp ...`). Restore the
// pre-0.101 behavior by running task commands through the OS native shell.
// See https://projen.io/docs/concepts/tasks/#shell
project.tasks.shell = TaskShell.system();

// Add global environment variables for all tasks
project.tasks.addEnvironment('PROJECT_NAME', project.name);

// Create workflows using externalized modules
createDeployWorkflow(project.github!);
createPublishWorkflow(project.github!);
customizeReleaseWorkflow(project);

// Create tasks using externalized modules
createBuildTasks(project);
createDeployTasks(project);
createPublishTasks(project);

project.synth();
