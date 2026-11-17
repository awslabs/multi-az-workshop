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
 * The package's scripts are local-only unless CI runs them: CI_SCRIPTS lists exactly those, and a
 * jest test (test/local-only.test.ts) works out from the generated workflows and tasks what CI runs
 * and fails when the two differ, so a script CI starts to need is never left out, and nothing CI
 * doesn't run is committed.
 */

/** Under projenrc/cre/scripts/: what the generated CI runs (its tasks' scripts and their imports). */
export const CI_SCRIPTS: readonly string[] = [
  'build/assets.py', 'build/build-docker.py', 'build/check-generated.py', 'build/check-stack-plan.py',
  'build/check-stack-wiring.py', 'build/container-plan.py', 'build/deploy-docker.py', 'build/deploy-stack.py',
  'build/image-tags.py', 'build/kaniko-build.sh', 'build/package.py', 'build/prune-assets.py', 'build/stacks.py',
  'build/publish.py', 'build/synth.py', 'build/versions.py', 'build/workshop.py',
  'cresetup/aws.py', 'cresetup/cfn.py', 'cresetup/constants.py', 'cresetup/git_state.py', 'cresetup/parallel.py',
  'cresetup/proc.py', 'cresetup/result.py', 'cresetup/stack_plan.py',
  'failure-scenario/clean-purity-scan.py', 'failure-scenario/ground-truth-check.py',
  'jest/global-setup.js', 'jest/global-teardown.js',
  'lib/crelib.py',
  'template/verify-constructs.py',
];

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
export function localOnlyIgnores(): string[] {
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
    ...[...CI_SCRIPTS, ...BOOTSTRAP_SCRIPTS].map((s) => `!/projenrc/cre/scripts/${s}`),
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
    execFileSync('python3', [path.join(tpl, 'packages', 'cre-projen', 'scripts', 'template', 'attach-template.py'), '--restore', tpl, out],
      { stdio: 'inherit' });
  }
}
