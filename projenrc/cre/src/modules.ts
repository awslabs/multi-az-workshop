import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Component } from 'projen';
import type { Project } from 'projen';
import { CRE_CONSTRUCTS_DIR } from './paths';

/**
 * The construct library's modules a project can list in `constructModules` (.projenrc.ts). core is
 * always installed. A project gets exactly the modules it lists (and what they need): their source in
 * cre-constructs/, and their steering linked. Add one when the design needs it, then `npx projen`.
 */
export enum CreModule {
  NETWORKING = 'networking',
  OBSERVABILITY = 'observability',
  ECS = 'ecs',
  /** Container images and Helm charts from S3 assets into ECR (an account with no registry of ours: Workshop Studio). */
  ECR_IMPORT = 'ecr-import',
  DNS = 'dns',
  LOAD_GENERATION = 'load-generation',
  ALLOWED_CIDR = 'auth/allowed-cidr',
  COGNITO = 'auth/cognito',
  /** Amazon-internal sign-in (Midway + bindle at CloudFront): private repositories only. */
  CLOUDFRONT_SIGNER = 'auth/cloudfront-signer',
  /** Amazon-internal sign-in (Midway through Amazon Federate at an ALB): private repositories only. */
  FEDERATE_ALB = 'auth/federate-alb',
}

/** In the library's order (scripts/template/sync-constructs.py MODULES; a test keeps them equal). */
export const ALL_MODULES: readonly CreModule[] = Object.values(CreModule);

/** The modules a public repository may never hold: they name and use Amazon-internal sign-in. */
export const INTERNAL_MODULES: readonly CreModule[] = [CreModule.CLOUDFRONT_SIGNER, CreModule.FEDERATE_ALB];

/** What a module's source imports from another module (core aside). */
export const MODULE_NEEDS: Readonly<Partial<Record<CreModule, readonly CreModule[]>>> = {
  [CreModule.LOAD_GENERATION]: [CreModule.OBSERVABILITY],
};

/** Each module's steering in the template (steering/<file>), linked when the module is installed. */
export function moduleSteering(m: CreModule): string[] {
  return [`constructs-${m.replace('/', '-')}.md`, ...(m === CreModule.LOAD_GENERATION ? ['load-generation.md'] : [])];
}

/**
 * The modules a project gets: what it lists, else the default (CloudFront Signer, the front door, in a
 * private repository; nothing in a public one), plus what its project type needs, plus what those
 * need. In the library's order. A public repository listing an internal module is refused.
 */
export function resolveModules(listed: readonly CreModule[] | undefined, required: readonly CreModule[], publicRepo: boolean): CreModule[] {
  const wanted = new Set<CreModule>([...(listed ?? (publicRepo ? [] : [CreModule.CLOUDFRONT_SIGNER])), ...required]);
  for (const m of [...wanted]) for (const n of MODULE_NEEDS[m] ?? []) wanted.add(n);
  const bad = [...wanted].filter((m) => !ALL_MODULES.includes(m));
  if (bad.length) throw new Error(`constructModules: no such module ${bad.join(', ')} (use CreModule.*).`);
  const internal = INTERNAL_MODULES.filter((m) => wanted.has(m));
  if (publicRepo && internal.length) {
    throw new Error(`constructModules: ${internal.join(', ')} sign people in with Amazon-internal auth, which a public repository `
      + "can't hold (github.visibility is 'public'). Use CreModule.COGNITO or CreModule.ALLOWED_CIDR instead, or keep the repo private.");
  }
  return ALL_MODULES.filter((m) => wanted.has(m));
}

/**
 * On `npx projen`, on a laptop with the template clone: when cre-constructs/ doesn't hold exactly
 * these modules at the template commit the project pins, install them (sync-constructs.py --at <pin>).
 * CI has no clone and installs nothing; its build checks the committed cre-constructs/ holds them
 * (verify-constructs.py --modules) and fails with "run npx projen" otherwise.
 */
export class ConstructModules extends Component {
  constructor(project: Project, public readonly modules: readonly CreModule[], private readonly templateDir: (outdir: string) => string) {
    super(project);
  }

  public override synthesize(): void {
    installConstructModules(this.project.outdir, this.modules, this.templateDir);
  }
}

/**
 * Install the modules into cre-constructs/ at the template commit the project pins, when what is
 * installed differs (the pin or the modules); otherwise nothing. The project type also runs it before
 * its plan synth, so an app that uses a construct a module or template update just brought in
 * synthesizes on that same `npx projen`. Never in CI (CI checks the committed copy) or under jest.
 */
export function installConstructModules(outdir: string, modules: readonly CreModule[], templateDir: (outdir: string) => string): void {
  if (process.env.CI || (process.env.JEST_WORKER_ID && !process.env.CRE_TEST_SYNC_CONSTRUCTS)) return;
  const tpl = templateDir(outdir);
  if (!tpl) return; // the steering says how to get a clone
  const read = (p: string) => { try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return {}; } };
  const pin: string | undefined = read(path.join(outdir, 'projenrc', 'cre', 'SOURCE.json')).templateSha;
  const installed = read(path.join(outdir, CRE_CONSTRUCTS_DIR, 'package.json'));
  const same = installed.creTemplateSha === pin && JSON.stringify(installed.creModules ?? null) === JSON.stringify(modules);
  if (same || !pin) return;
  // The pin reaches git as an argument (sync-constructs.py --at): only a full commit id, never a
  // value git could read as an option.
  if (!/^[0-9a-f]{40}$/.test(pin)) {
    throw new Error(`cre: projenrc/cre/SOURCE.json templateSha ${JSON.stringify(pin)} is not a full commit id: `
      + 'run npx projen update-template to pin the template clone\'s commit.');
  }
  execFileSync('python3', [path.join(tpl, 'packages', 'cre-projen', 'scripts', 'template', 'sync-constructs.py'), tpl,
    path.join(outdir, CRE_CONSTRUCTS_DIR), '--modules', modules.join(','), '--at', pin], { stdio: 'inherit' });
}
