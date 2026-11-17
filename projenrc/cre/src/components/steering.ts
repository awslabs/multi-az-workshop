import * as fs from 'fs';
import * as path from 'path';
import { Component } from 'projen';
import type { Project } from 'projen';

/**
 * Steering every project type gets. Only the core is `inclusion: always` (the type file, tooling,
 * the tasks, project structure, the pipeline essentials, the provider's file);
 * the rest is `inclusion: auto`, loaded when a request matches its description, so a session starts
 * with the few files every change needs (review 10c F17).
 */
export const ALWAYS_STEERING = ['project-structure.md', 'tooling.md', 'tasks.md', 'pipelines.md'];
// The construct modules' steering comes with the modules (src/modules.ts moduleSteering).
export const ON_DEMAND_STEERING = ['pipelines-detail.md', 'constructs.md', 'constructs-core.md', 'versions.md', 'failure-injection.md', 'fidelity.md'];
export const BASE_STEERING = [...ALWAYS_STEERING, ...ON_DEMAND_STEERING];

/** The template this code runs from, when it runs from the template itself (its tests). */
const OWN_TEMPLATE = path.join(__dirname, '..', '..', '..', '..');

/**
 * The template clone of a project: the clone .cre/template.json records, else the sibling
 * SOURCE.json names (crelib.project_template_dir's lookup); the template itself when this code runs
 * from it. "" when there is none (CI).
 */
export function templateClone(outdir: string, own: string = OWN_TEMPLATE): string {
  const isClone = (c: unknown): c is string => typeof c === 'string' && fs.existsSync(path.join(c, 'packages', 'cre-projen', 'src'))
    && fs.existsSync(path.join(c, 'recipe', 'recipe.md'));
  if (isClone(own)) return own;
  const read = (p: string) => { try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return {}; } };
  const recorded = read(path.join(outdir, '.cre', 'template.json')).templatePath;
  const name = read(path.join(outdir, 'projenrc', 'cre', 'SOURCE.json')).templateDirName ?? 'cre-demo-template';
  const sibling = /^[^/]+$/.test(name) && name !== '..' ? path.join(path.dirname(path.resolve(outdir)), name) : undefined;
  for (const c of [recorded, sibling]) if (isClone(c)) return c;
  return '';
}

/** The template clone's steering directory for a project ("" when there is no clone). */
export function templateSteeringDir(outdir: string, own: string = OWN_TEMPLATE): string {
  const t = templateClone(outdir, own);
  return t ? path.join(t, 'packages', 'cre-projen', 'steering') : '';
}

/**
 * The project's steering: `.kiro/steering/cre-<name>.md`, each a LINK to the file in the template
 * clone (where alone it is edited), for this project's type, provider and modules. All local-only
 * (src/local-only.ts): made on a
 * laptop with a template clone, never committed, and not projen's files, so CI (no clone) makes none
 * and its generated files match. A `cre-*.md` the project no longer gets is removed; the project's
 * own steering is never touched.
 */
export class Steering extends Component {
  constructor(
    project: Project,
    public readonly files: string[],
    private readonly sources?: string,
  ) {
    super(project);
  }

  public override synthesize(): void {
    const sources = this.sources ?? templateSteeringDir(this.project.outdir);
    if (!sources || !fs.existsSync(sources)) {
      // CI has no template clone, on purpose. A laptop without one: say how.
      if (!process.env.CI && !process.env.JEST_WORKER_ID) {
        console.warn('cre: no cre-demo-template clone recorded for this project or beside it, so no steering is linked: '
          + 'clone it beside the project (or npx projen update-template --from <path>), then npx projen');
      }
      return;
    }
    const dir = path.join(this.project.outdir, '.kiro', 'steering');
    fs.mkdirSync(dir, { recursive: true });
    const want = new Map(this.files.map((f) => [`cre-${f}`, f]));
    for (const f of fs.readdirSync(dir)) {
      if (/^cre-.*\.md$/.test(f) && !want.has(f)) fs.rmSync(path.join(dir, f), { force: true });
    }
    for (const [name, file] of want) {
      const p = path.join(dir, name);
      if (fs.existsSync(p) || isLink(p)) fs.rmSync(p, { force: true });
      if (!fs.existsSync(path.join(sources, file))) throw new Error(`cre: the template clone has no steering/${file} (pull it).`);
      // Relative between the real paths: a link climbs the physical directories (/var is /private/var on macOS).
      fs.symlinkSync(path.relative(fs.realpathSync(dir), fs.realpathSync(path.join(sources, file))), p);
    }
  }
}

function isLink(p: string): boolean {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
}

export function createSteering(project: Project, typeSteering: string, provider: 'gitlab' | 'github',
  extraSteering: string[] = [], sources?: string): Steering {
  return new Steering(project, [...BASE_STEERING, typeSteering, `${provider}.md`, ...extraSteering], sources);
}
