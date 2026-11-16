// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { AwsCdkTypeScriptApp } from 'projen/lib/awscdk';
import { Testing } from 'projen/lib/testing';
import { createDeployWorkflow } from './deploy-workflow';

function workflows(teardownAfterDeploy = true): Record<string, any> {
  const project = new AwsCdkTypeScriptApp({ name: 'test', defaultReleaseBranch: 'main', cdkVersion: '2.248.0', github: true });
  createDeployWorkflow(project.github!, { teardownAfterDeploy });
  const out = Testing.synth(project);
  // projen's own YAML parser (a dependency of projen, not of this project).
  // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-extraneous-dependencies
  const parse = (f: string) => require('yaml').parse(out[f]);
  return { deploy: parse('.github/workflows/deploy.yml'), teardown: out['.github/workflows/teardown.yml'] ? parse('.github/workflows/teardown.yml') : undefined };
}

test('off by default: no teardown step, no keep input, no teardown workflow', () => {
  const { deploy, teardown } = workflows(false);
  expect(deploy.jobs.deploy.steps.map((s: any) => s.name)).not.toContain('Teardown');
  expect(deploy.on.workflow_dispatch).toEqual({});
  expect(teardown).toBeUndefined();
});

describe('deploy and teardown workflows with teardownAfterDeploy', () => {
  const { deploy, teardown } = workflows();

  test('a deploy from main tears the stack down again, unless a manual run keeps it', () => {
    const steps = deploy.jobs.deploy.steps;
    const names = steps.map((s: any) => s.name);
    expect(names.slice(-3)).toEqual(['Deploy', 'Configure AWS credentials for the teardown', 'Teardown']);
    const td = steps[names.indexOf('Teardown')];
    expect(td.run).toBe('npx projen destroy:workshop --region ${{ env.AWS_REGION }}');
    // Only after a deploy that succeeded (the default), and never in a kept manual run.
    expect(td.if).toBe("!(github.event_name == 'workflow_dispatch' && inputs.keep)");
    expect(deploy.on.workflow_dispatch.inputs.keep.type).toBe('boolean');
    // The delete takes over an hour: a fresh session that lasts.
    expect(steps[names.indexOf('Configure AWS credentials for the teardown')].with['role-duration-seconds']).toBe(10800);
  });

  test('the teardown workflow runs by hand and weekly, never alongside a deploy', () => {
    expect(teardown.on.schedule).toEqual([{ cron: '0 0 * * 1' }]);
    expect(teardown.on.workflow_dispatch).toEqual({});
    expect(teardown.concurrency).toEqual(deploy.concurrency);
    expect(teardown.concurrency).toEqual({ 'group': 'deploy', 'cancel-in-progress': false });
    const steps = teardown.jobs.teardown.steps;
    expect(steps[steps.length - 1].run).toBe('npx projen destroy:workshop --region ${{ env.AWS_REGION }}');
    expect(teardown.jobs.teardown.environment).toBe('AWS');
  });
});
