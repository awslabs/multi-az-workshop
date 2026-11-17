import type { awscdk } from 'projen';
import { CRE_SCRIPTS } from '../paths';
import type { PlannedStack } from './stack-plan';

/**
 * The deploy's projen tasks, generated from the project's stacks (the CDK app, read into cre-stacks.json,
 * resolved by stack-plan.ts). The CI pipelines run one job per stack (stack-jobs.ts) and call:
 *
 *   deploy:upload  make each listed region's assets bucket if missing, and publish templates and
 *                  assets to it (deploy:s3, scripts/build/assets.py), and image tarballs to ECR in
 *                  the regions of the stacks that use them (deploy:docker, with containerImages)
 *   deploy:stack   deploy one stack with the variables its job sets (scripts/build/deploy-stack.py)
 *   deploy:prune   remove old asset prefixes (keeps the current one and two before it)
 *
 * `deploy` is the same pipeline on a machine (scripts/build/deploy-local.py): deploy:upload, then
 * deploy:stack once per stack in deploy order with exactly its CI job's variables (outputs from the
 * dotenv files the stacks it needs wrote), then deploy:prune. Never CloudFormation exports, never
 * matching by name.
 */
export interface DeployTaskOptions {
  /**
   * Registers `deploy:docker` (crane pushes the image tarballs from dist/content.zip to ECR in the
   * regions of the stacks that use each image) and folds it into `deploy:upload`. Both providers.
   */
  readonly containerImages?: boolean;
  /** Delete old deploy prefixes after a successful deploy (keeps current + 2). @default true */
  readonly pruneAssets?: boolean;
}

export const DEFAULT_BINDLE_ID = 'amzn1.bindle.resource.v4o66fxvd3zfcqvcmhxq'; // aws-cre

export function createDeployTasks(
  project: awscdk.AwsCdkTypeScriptApp,
  stacks: readonly PlannedStack[],
  opts: DeployTaskOptions = {},
): void {
  const regions = [...new Set(stacks.map((s) => s.region))];
  const regionList = regions.join(' ');

  // Every region's bucket made if missing (a CloudFormation stack per region), then dist/content.zip
  // synced to it (scripts/build/assets.py). The regions are a literal here, never an env var threaded
  // down from `deploy`: projen forwards a spawn step's env one hop and this chain is two (deploy →
  // deploy:upload → deploy:s3), so a threaded region published everything to the ambient region's
  // bucket in three demos; test/deploy-tasks.test.ts EXECUTES this tree to keep it fixed.
  const deployS3 = project.addTask('deploy:s3', {
    description: "Internal CI job step (use npx projen deploy): Make every listed region's assets bucket if missing, and sync dist/content.zip's contents to it.",
    requiredEnv: ['ASSETS_PREFIX', 'PROJECT_NAME'],
    // No stacks (a fresh scaffold): no region, so nothing to make or upload.
    steps: regions.length === 0 ? [{ say: 'No stacks in the app yet: nothing to upload.' }] : [
      { say: 'Unpacking dist/content.zip...' },
      { exec: 'rm -rf dist/content && mkdir -p dist/content && unzip -q dist/content.zip -d dist/content' },
      { exec: `python3 ${CRE_SCRIPTS}/build/assets.py upload --regions "${regionList}"` },
    ],
  });

  const deployUpload = project.addTask('deploy:upload', {
    description: 'Internal CI job step (use npx projen deploy): Publish build artifacts: S3 content, and container images with containerImages.',
  });
  deployUpload.spawn(deployS3);

  if (opts.containerImages) {
    // Each image goes to the regions of the stacks whose asset manifests list it (container-plan
    // records which stacks use each image; the list says where each stack goes).
    const stackRegions = stacks.map((s) => `${s.id}=${s.region}`).join(' ');
    const deployDocker = project.addTask('deploy:docker', {
      description: 'Internal CI job step (use npx projen deploy): Push pre-built image tarballs to ECR via crane, in the regions of the stacks that use them.',
      steps: [{ exec: `python3 ${CRE_SCRIPTS}/build/deploy-docker.py --stack-regions "${stackRegions}"` }],
    });
    deployUpload.spawn(deployDocker);
  }

  // AwsCdkTypeScriptApp ships a `deploy` task that runs `cdk deploy`. Templates go to AWS via
  // `aws cloudformation` against an uploaded S3 prefix instead, so replace it (gotcha 8).
  project.tasks.removeTask('deploy');

  // One stack: what every CI stack job runs. Its variables come from the job (stack-jobs.ts);
  // deploy-stack.py checks them and deploys. It resolves nothing.
  project.addTask('deploy:stack', {
    description: 'Internal CI job step (use npx projen deploy): Deploy one stack with the variables its pipeline job sets (see cre-stacks.json `jobs`).',
    steps: [{ exec: `python3 ${CRE_SCRIPTS}/build/deploy-stack.py` }],
  });

  if (opts.pruneAssets !== false) {
    project.addTask('deploy:prune', {
      description: 'Internal CI job step (use npx projen deploy): Remove old deploy prefixes from every region bucket (keeps current + 2).',
      requiredEnv: ['ASSETS_PREFIX', 'PROJECT_NAME'],
      // The regions, as a literal: each one's bucket is named from the project and the account
      // (assets.py), never parsed from a name (review 10c D2).
      steps: [{ exec: `PRUNE_REGIONS="${regionList}" python3 ${CRE_SCRIPTS}/build/prune-assets.py` }],
    });
  }

  // The pipeline on your machine: deploy-local.py does what the CI runner does. It reads the jobs
  // from cre-stacks.json, gets every variable they need (role ARNs from the setup stacks, the
  // rest from the environment, then a prompt), and runs deploy:upload, deploy:stack once per stack in deploy order with exactly that
  // job's variables (and the outputs of the stacks it needs), then deploy:prune.
  project.addTask('deploy', {
    description: 'Run the deploy pipeline locally (builds first): deploy:upload, deploy:stack per stack in order, deploy:prune. [--stack id] [--no-build] [--profile p] [--dns-profile p]',
    steps: [{ exec: `python3 ${CRE_SCRIPTS}/build/deploy-local.py "$@"`, receiveArgs: true }],
  });

  // projen's cdk tasks that act on AWS around the pipeline: `destroy` (cdk destroy, unaware of the
  // assets prefix and the cross-account DNS stack) and `diff` (cdk diff against the bootstrap-less
  // synthesizer), and `clobber` (git reset --hard + clean -fdx: deletes uncommitted work). Replaced
  // by `stacks`, `teardown` (#29, #30).
  for (const name of ['destroy', 'diff', 'clobber']) project.tasks.removeTask(name);
  const stacksPy = (cmd: string) => [{ exec: `python3 ${CRE_SCRIPTS}/build/stacks.py ${cmd} "$@"`, receiveArgs: true }];
  project.addTask('stacks', {
    description: "Each planned stack's deployed status, plus orphans (this project's stacks that main's committed plan no longer has). [--profile p] [--dns-profile p]",
    steps: stacksPy('status'),
  });
  project.addTask('stacks:outputs', {
    description: "The deployed stacks' outputs (URLs, ids) as `<stack> <Key>=<Value>`. [--stack id]... [--profile p] [--dns-profile p]",
    steps: stacksPy('outputs'),
  });
  project.addTask('teardown', {
    description: 'Delete the stacks, each after the stacks that need it (independent ones at once). Running it deletes; --dry-run only lists them, so run that first. [--orphans] [--stack id]... [--profile p] [--dns-profile p]',
    steps: stacksPy('teardown'),
  });
}
