// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { AwsCdkTypeScriptApp } from 'projen/lib/awscdk';
import { NodePackageManager } from 'projen/lib/javascript';
import { Testing } from 'projen/lib/testing';
import { addTransitiveDependencyUpgrade } from './upgrade-tasks';
import { addVersionTasks } from './versions-tasks';

function newProject(): AwsCdkTypeScriptApp {
  return new AwsCdkTypeScriptApp({
    name: 'test',
    defaultReleaseBranch: 'main',
    cdkVersion: '2.248.0',
    packageManager: NodePackageManager.YARN_BERRY,
    depsUpgrade: true,
    github: true,
  });
}

describe('addVersionTasks', () => {
  test('the build checks the file and the templates after synth; the upgrade updates it first', () => {
    const project = newProject();
    addTransitiveDependencyUpgrade(project);
    addVersionTasks(project);
    const tasks = Testing.synth(project)['.projen/tasks.json'].tasks;
    expect(tasks['versions:check'].steps).toEqual([{ exec: 'python3 build/versions.py check --file build/versions.json --templates cdk.out' }]);
    const post = tasks['post-compile'].steps;
    expect(post.findIndex((s: any) => s.spawn === 'versions:check')).toBeGreaterThan(post.findIndex((s: any) => s.spawn === 'synth:silent'));
    // Before the lockfile refresh, so a lookup failure stops the upgrade before anything else runs.
    expect(tasks['post-upgrade'].steps[0]).toEqual({ spawn: 'versions:update' });
  });

  test('the upgrade job assumes the read-only versions role by OIDC before it upgrades', () => {
    const project = newProject();
    addVersionTasks(project);
    Testing.synth(project);
    const job = project.upgradeWorkflow!.workflows[0].getJob('upgrade') as any;
    expect(job.permissions).toEqual({ contents: 'read', idToken: 'write' });
    const ids = job.steps.map((s: any) => s.id);
    expect(ids.indexOf('versions_credentials')).toBe(ids.indexOf('upgrade_dependencies') - 1);
    const creds = job.steps[ids.indexOf('versions_credentials')];
    expect(creds.uses).toMatch(/^aws-actions\/configure-aws-credentials@[0-9a-f]{40}$/);
    expect(creds.with).toEqual({ 'role-to-assume': '${{ secrets.VERSIONS_ROLE_ARN }}', 'aws-region': 'us-east-1' });
  });
});
