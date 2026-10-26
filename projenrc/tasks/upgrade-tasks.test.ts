// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { NodePackageManager, NodeProject } from 'projen/lib/javascript';
import { Testing } from 'projen/lib/testing';
import { addTransitiveDependencyUpgrade, TRANSITIVE_UPGRADE_COMMAND } from './upgrade-tasks';

function newProject(options: Partial<{ packageManager: NodePackageManager; depsUpgrade: boolean }> = {}): NodeProject {
  return new NodeProject({
    name: 'test',
    defaultReleaseBranch: 'main',
    packageManager: options.packageManager ?? NodePackageManager.YARN_BERRY,
    depsUpgrade: options.depsUpgrade ?? true,
    github: true,
  });
}

describe('addTransitiveDependencyUpgrade', () => {
  test('appends the transitive re-resolve step to post-upgrade', () => {
    const project = newProject();
    addTransitiveDependencyUpgrade(project);

    const tasks = Testing.synth(project)['.projen/tasks.json'].tasks;
    const steps = tasks['post-upgrade'].steps;
    expect(steps[steps.length - 1]).toMatchObject({ exec: TRANSITIVE_UPGRADE_COMMAND });
  });

  test('runs as part of the upgrade task, after the direct-dependency upgrade', () => {
    const project = newProject();
    project.addDevDeps('constructs');
    addTransitiveDependencyUpgrade(project);

    const tasks = Testing.synth(project)['.projen/tasks.json'].tasks;
    const upgradeSteps: Array<{ execArgs?: string[]; spawn?: string }> = tasks.upgrade.steps;
    const directUpgrade = upgradeSteps.findIndex((s) => s.execArgs?.slice(0, 3).join(' ') === 'yarn up -R');
    const postUpgrade = upgradeSteps.findIndex((s) => s.spawn === 'post-upgrade');
    expect(directUpgrade).toBeGreaterThanOrEqual(0);
    expect(postUpgrade).toBeGreaterThan(directUpgrade);
  });

  test('covers unscoped and scoped packages, quoted so the shell does not expand the globs', () => {
    expect(TRANSITIVE_UPGRADE_COMMAND).toBe("yarn up -R '*' '@*/*'");
  });

  test('rejects package managers other than yarn berry', () => {
    const project = newProject({ packageManager: NodePackageManager.NPM });
    expect(() => addTransitiveDependencyUpgrade(project)).toThrow(/requires yarn berry/);
  });

  test('fails loudly when dependency upgrades are disabled', () => {
    const project = newProject({ depsUpgrade: false });
    expect(() => addTransitiveDependencyUpgrade(project)).toThrow(/post-upgrade task not found/);
  });
});
