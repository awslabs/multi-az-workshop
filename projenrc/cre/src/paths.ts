/**
 * Where the package's bundled scripts live inside a demo, relative to the demo root.
 *
 * `/cre-demo-init` (and `npx projen update-template`) copy this package's `src/`, `scripts/` and
 * `steering/` into `<demo>/projenrc/cre/`, so every task `exec` and CI job references scripts at
 * this fixed path. Fixed rather than derived from `__dirname`, so the rendered `.projen/tasks.json`
 * and CI files are identical on every machine.
 */
export const CRE_SCRIPTS = 'projenrc/cre/scripts';

/**
 * Where the construct library is installed in a project, and the package name code imports it by.
 * It behaves like an npm dependency (`link:./cre-constructs`) because there is no artifact
 * repository to publish it to yet.
 */
export const CRE_CONSTRUCTS_DIR = 'cre-constructs';
export const CRE_CONSTRUCTS_PACKAGE = '@cre/constructs';
