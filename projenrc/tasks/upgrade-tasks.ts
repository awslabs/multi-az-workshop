// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { NodePackageManager, NodeProject } from 'projen/lib/javascript';

/**
 * Re-resolves every entry in yarn.lock to the newest version its declared
 * range allows. Yarn's `*` glob does not match scoped names, so `@*\/*` is
 * needed as well (without it @ungap/structured-clone stayed on a vulnerable
 * 1.3.0). The globs are single-quoted so the shell passes them to yarn as-is.
 * `--mode=update-lockfile` is not used, so node_modules stays in sync with
 * the refreshed lockfile.
 */
export const TRANSITIVE_UPGRADE_COMMAND = "yarn up -R '*' '@*/*'";

/**
 * Extends projen's `upgrade` task (run weekly by the upgrade-main workflow) so
 * it also refreshes transitive dependencies.
 *
 * projen's upgrade only runs `yarn up -R <direct deps>`, so a transitive
 * package (e.g. handlebars under ts-jest) only moves when one of its parents
 * publishes a new version. Security fixes in transitive packages therefore sat
 * in Dependabot alerts until fixed by hand. Re-resolving the whole lockfile
 * picks up those fixes within the ranges the parents already allow; package.json
 * ranges and `resolutions` are untouched and still apply.
 *
 * The step is added to `post-upgrade`, which projen's upgrade task spawns last,
 * so its lockfile changes land in the same upgrade-main PR and go through the
 * same `build` check before merging.
 */
export function addTransitiveDependencyUpgrade(project: NodeProject): void {
  if (project.package.packageManager !== NodePackageManager.YARN_BERRY) {
    throw new Error(
      `addTransitiveDependencyUpgrade requires yarn berry, found ${project.package.packageManager}`,
    );
  }

  const postUpgrade = project.tasks.tryFind('post-upgrade');
  if (!postUpgrade) {
    throw new Error('post-upgrade task not found; is depsUpgrade enabled?');
  }

  postUpgrade.exec(TRANSITIVE_UPGRADE_COMMAND, {
    name: 'Re-resolve transitive dependencies to the newest versions their ranges allow',
  });
}
