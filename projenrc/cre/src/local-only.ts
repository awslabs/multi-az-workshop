import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Component } from 'projen';
import type { Project } from 'projen';

/**
 * What a project never commits: everything only a laptop needs that cre-demo-template supplies. It
 * is copied from the template clone (update-template, and `npx projen` on a fresh clone) and
 * gitignored, so a repository holds only what its CI runs, and nothing the template already has
 * (the steering, agent docs and skills, setup, the git tasks) is stored twice or published.
 *
 * The package's scripts are local-only unless the project's own CI runs them: CI_SCRIPTS lists every
 * script some project's CI runs, ciScriptsFor() the ones this project's does, and a jest test
 * (test/local-only.test.ts) works out from the generated workflows and tasks what each shape's CI
 * runs and fails when they differ, so a script CI starts to need is never left out, and nothing a
 * project's CI doesn't run is committed.
 */

/** Under projenrc/cre/scripts/: what the generated CI runs (its tasks' scripts and their imports). */
export const CI_SCRIPTS: readonly string[] = [
  'build/assets.py', 'build/build-docker.py', 'build/check-generated.py', 'build/check-stack-plan.py',
  'build/check-stack-wiring.py', 'build/container-plan.py', 'build/deploy-docker.py', 'build/deploy-stack.py',
  'build/image-tags.py', 'build/kaniko-build.sh', 'build/package.py', 'build/prune-assets.py', 'build/stacks.py',
  'build/publish.py', 'build/release.py', 'build/synth.py', 'build/versions.py', 'build/workshop.py',
  'cresetup/aws.py', 'cresetup/cfn.py', 'cresetup/constants.py', 'cresetup/git_state.py', 'cresetup/parallel.py',
  'cresetup/proc.py', 'cresetup/result.py', 'cresetup/stack_plan.py',
  'failure-scenario/clean-purity-scan.py', 'failure-scenario/ground-truth-check.py',
  'jest/global-setup.js', 'jest/global-teardown.js',
  'lib/crelib.py',
  'template/verify-constructs.py',
];

/** What decides which of CI_SCRIPTS a project's own CI runs. */
export interface CiShape {
  readonly github: boolean;
  readonly containerImages: boolean;
  readonly disableDeploy: boolean;
  /** CreWorkshopStudio: releases and publish. */
  readonly workshop: boolean;
  /** CreFailureScenario: its clean-purity and ground-truth checks. */
  readonly failureScenario: boolean;
}

/**
 * The CI_SCRIPTS this project's CI runs: a project commits only those, not every project type's
 * (review 2026-11 G2). test/local-only.test.ts works the set out from the generated CI for every
 * shape and fails when this differs.
 */
export function ciScriptsFor(shape: CiShape): string[] {
  const drop = new Set<string>();
  const images = ['build/container-plan.py', 'build/deploy-docker.py', 'build/image-tags.py'];
  if (!shape.containerImages) [...images, 'build/build-docker.py', 'build/kaniko-build.sh'].forEach((x) => drop.add(x));
  else drop.add(shape.github ? 'build/kaniko-build.sh' : 'build/build-docker.py'); // the provider's image build
  if (!shape.workshop) ['build/publish.py', 'build/release.py', 'build/workshop.py'].forEach((x) => drop.add(x));
  if (!shape.failureScenario) ['failure-scenario/clean-purity-scan.py', 'failure-scenario/ground-truth-check.py'].forEach((x) => drop.add(x));
  if (shape.disableDeploy) {
    ['build/assets.py', 'build/deploy-docker.py', 'build/deploy-stack.py', 'build/prune-assets.py', 'build/stacks.py', 'build/release.py', 'cresetup/cfn.py']
      .forEach((x) => drop.add(x));
    // GitHub checks the generated files in the deploy's build (the PR build regenerates them itself).
    if (shape.github) drop.add('build/check-generated.py');
  }
  return CI_SCRIPTS.filter((x) => !drop.has(x));
}

/**
 * Committed though CI never runs it: the launcher `npx projen update-template` starts from on a fresh
 * clone (everything else it runs comes from the template clone).
 */
export const BOOTSTRAP_SCRIPTS: readonly string[] = ['lib/template.py'];

/** The template's skills every project links (.kiro/skills/<name>): src/vended-skills.txt. */
export function vendedSkills(): string[] {
  return fs.readFileSync(path.join(__dirname, 'vended-skills.txt'), 'utf-8').split('\n')
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

/** The project's .gitignore lines for what is local-only, in order (a `!` line re-includes). */
export function localOnlyIgnores(shape: CiShape): string[] {
  return [
    // The agent docs, steering and skills: the template's, linked locally.
    '/AGENTS.md',
    '/CLAUDE.md',
    '/.kiro/steering/cre-*.md',
    ...vendedSkills().map((s) => `/.kiro/skills/${s}`),
    '/.claude/skills',
    // Claude Code's links to the steering (src/components/steering.ts): its one home is .kiro/steering.
    '/.claude/rules/',
    '/.claude/commands/',
    // The package's local-only parts: the setup app, and every script CI doesn't run.
    '/projenrc/cre/setup-cdk/',
    '/projenrc/cre/scripts/**',
    '!/projenrc/cre/scripts/**/',
    ...[...ciScriptsFor(shape), ...BOOTSTRAP_SCRIPTS].map((s) => `!/projenrc/cre/scripts/${s}`),
  ];
}

/**
 * On `npx projen`, on a laptop with the template clone: a clone that has none of the local-only files
 * (a fresh clone, a teammate's) gets them, from the template at the commit the project pins
 * (attach-template.py --restore): setup, the laptop's scripts, AGENTS.md, CLAUDE.md, the skill links.
 * CI has no clone and needs none of them.
 */
export class LocalOnlyFiles extends Component {
  constructor(project: Project, private readonly templateDir: (outdir: string) => string) {
    super(project);
  }

  public override synthesize(): void {
    if (process.env.CI || process.env.JEST_WORKER_ID) return;
    const out = this.project.outdir;
    if (fs.existsSync(path.join(out, 'projenrc', 'cre', 'scripts', 'git', 'push.py'))) return; // already here
    const tpl = this.templateDir(out);
    if (!tpl) return; // the steering component says how to get one
    const problem = restoreLocalOnly(tpl, out);
    if (problem) {
      console.error(`cre: npx projen FAILED: ${problem}`);
      process.exit(1);
    }
  }
}

/**
 * attach-template.py --restore from the template clone; a failure as one line that says what to do
 * (undefined when it worked). A clone older than the project's template has an attach-template.py
 * without --restore (review 2026-11 E2): its usage error and a Node stack named no cause.
 */
export function restoreLocalOnly(tpl: string, out: string, run: typeof execFileSync = execFileSync): string | undefined {
  try {
    run('python3', [path.join(tpl, 'packages', 'cre-projen', 'scripts', 'template', 'attach-template.py'), '--restore', tpl, out],
      { stdio: 'inherit' });
    return undefined;
  } catch {
    let pin = '';
    try { pin = JSON.parse(fs.readFileSync(path.join(out, 'projenrc', 'cre', 'SOURCE.json'), 'utf-8')).templateSha ?? ''; } catch { /* none */ }
    return `this clone has none of the template's local-only files, and the template clone at ${tpl} couldn't restore them `
      + `(above). It is likely older than this project's template${pin ? ` (pinned ${pin.slice(0, 9)})` : ''}: update it with `
      + `git -C ${tpl} pull, then run npx projen again.`;
  }
}
