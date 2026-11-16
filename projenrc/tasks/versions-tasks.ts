// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { AwsCdkTypeScriptApp } from 'projen/lib/awscdk';

/** The version file: every externally sourced version the workshop deploys (build/versions.py documents the kinds). */
export const VERSIONS_FILE = 'build/versions.json';

/** The repo secret holding the weekly upgrade's read-only role (build/versions-role.yaml). */
export const VERSIONS_ROLE_SECRET = 'VERSIONS_ROLE_ARN';

/** Where the upgrade job's lookups run (an ec2-ami entry reads each of its own regions). */
export const VERSIONS_REGION = 'us-east-1';

/** aws-actions/configure-aws-credentials v6.3.0, pinned (as deploy.yml pins it). */
const CONFIGURE_AWS_CREDENTIALS = 'aws-actions/configure-aws-credentials@e1253824e5c10ff9df46874f81ed3ec929e19cfd';

/**
 * The version file in the build and the weekly upgrade:
 *  - `versions:check` (after synth, in post-compile): every entry has a kind with a lookup, and no
 *    synthesized template takes a version from elsewhere (an SSM-typed AMI parameter, an EKS add-on
 *    without a version, a node group without a release version, an engine without a version).
 *  - `versions:update` (first in post-upgrade): each entry moves to the newest version its `update`
 *    range allows, so the weekly upgrade-main PR carries it, builds it and, merged, deploys it.
 *  - the upgrade job assumes the read-only versions role through OIDC before `projen upgrade`.
 */
export function addVersionTasks(project: AwsCdkTypeScriptApp): void {
  const check = project.addTask('versions:check', {
    description: `Check ${VERSIONS_FILE} (every entry has a lookup) and that no synthesized template takes a version from elsewhere`,
    exec: `python3 build/versions.py check --file ${VERSIONS_FILE} --templates cdk.out`,
  });
  project.postCompileTask.spawn(check);

  const update = project.addTask('versions:update', {
    description: `Move each ${VERSIONS_FILE} entry to the newest version its update allows (AWS lookups need credentials)`,
    exec: `python3 build/versions.py update --file ${VERSIONS_FILE}`,
  });
  const postUpgrade = project.tasks.tryFind('post-upgrade');
  if (!postUpgrade) throw new Error('post-upgrade task not found; is depsUpgrade enabled?');
  postUpgrade.prependSpawn(update);

  const wf = project.upgradeWorkflow?.workflows[0];
  if (!wf) throw new Error('upgrade-main workflow not found; is depsUpgrade enabled?');
  const job = wf.getJob('upgrade') as { permissions?: Record<string, string>; steps?: Array<Record<string, unknown>> };
  const steps = [...(job.steps ?? [])];
  const at = steps.findIndex((s) => s.id === 'upgrade_dependencies');
  if (at < 0) throw new Error('upgrade-main has no upgrade_dependencies step to put the version credentials before.');
  steps.splice(at, 0, {
    name: 'AWS credentials for the version lookups (read-only)',
    id: 'versions_credentials',
    uses: CONFIGURE_AWS_CREDENTIALS,
    with: { 'role-to-assume': `\${{ secrets.${VERSIONS_ROLE_SECRET} }}`, 'aws-region': VERSIONS_REGION },
  });
  wf.updateJob('upgrade', { ...(job as object), permissions: { ...job.permissions, idToken: 'write' }, steps } as never);
}
