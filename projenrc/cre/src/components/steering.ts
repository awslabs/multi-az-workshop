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
 * The template clone of a project, found as crelib.project_template_dir finds it (one lookup in
 * both languages): the clone .cre/template.json records (older projects: SOURCE.json's
 * templatePath), else the sibling directory SOURCE.json names (`templateDirName`, a plain name);
 * the template itself when this code runs from it. "" when there is none (CI).
 */
export function templateClone(outdir: string, own: string = OWN_TEMPLATE): string {
  // crelib.is_template_clone; the template's own checkout also has the recipe (crelib.template_dir).
  const isClone = (c: unknown): c is string => typeof c === 'string' && c !== '' && fs.existsSync(path.join(c, 'packages', 'cre-projen', 'src'));
  if (isClone(own) && fs.existsSync(path.join(own, 'recipe', 'recipe.md'))) return own;
  const read = (p: string) => { try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return {}; } };
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const source = read(path.join(outdir, 'projenrc', 'cre', 'SOURCE.json'));
  const recorded = str(read(path.join(outdir, '.cre', 'template.json')).templatePath) || str(source.templatePath);
  if (isClone(recorded)) return recorded;
  const name = str(source.templateDirName) || 'cre-demo-template';
  if (name.includes('/') || name === '..' || name === '.') return '';
  const sibling = path.join(path.dirname(path.resolve(outdir)), name);
  return isClone(sibling) ? sibling : '';
}

/** The template clone's steering directory for a project ("" when there is no clone). */
export function templateSteeringDir(outdir: string, own: string = OWN_TEMPLATE): string {
  const t = templateClone(outdir, own);
  return t ? path.join(t, 'packages', 'cre-projen', 'steering') : '';
}

/**
 * The project's steering: `.kiro/steering/cre-<name>.md`, each a LINK to the file in the template
 * clone (where alone it is edited), for this project's type, provider and modules. Claude Code gets
 * the same files, every `.kiro/steering/*.md` (the project's own too): one Kiro loads always
 * (`inclusion: always`, or none) is linked into `.claude/rules/`, which Claude Code loads at launch;
 * any other into `.claude/commands/`, which it reads when the description matches.
 *
 * All local-only (src/local-only.ts): made on a laptop with a template clone, never committed, and
 * not projen's files, so CI (no clone) makes none and its generated files match. A `cre-*.md` the
 * project no longer gets is removed, and so is a Claude link to a file that is gone; the project's
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
      link(path.join(sources, file), p);
    }
    linkForClaude(this.project.outdir, dir);
  }
}

/**
 * Claude Code's copy of the steering: each `.kiro/steering/*.md` linked into `.claude/rules/` (loaded
 * at launch) when Kiro loads it always, else into `.claude/commands/` (read when its description
 * matches). Only links are made or removed there.
 */
function linkForClaude(outdir: string, steering: string): void {
  const kiro = fs.realpathSync(steering);
  const want = new Set<string>();
  for (const f of fs.readdirSync(kiro).filter((n) => n.endsWith('.md'))) {
    // Kiro's default inclusion is always.
    const inclusion = /^inclusion:\s*(\S+)/m.exec(frontMatter(path.join(kiro, f)))?.[1] ?? 'always';
    want.add(path.join(outdir, '.claude', inclusion === 'always' ? 'rules' : 'commands', f));
  }
  for (const d of ['rules', 'commands'].map((n) => path.join(outdir, '.claude', n))) {
    fs.mkdirSync(d, { recursive: true });
    for (const p of fs.readdirSync(d).map((n) => path.join(d, n))) if (isLink(p)) fs.rmSync(p);
  }
  // Each to the .kiro/steering file (itself a link, for the template's): one place says where it points.
  for (const p of want) {
    if (!fs.existsSync(p)) fs.symlinkSync(path.relative(fs.realpathSync(path.dirname(p)), path.join(kiro, path.basename(p))), p);
  }
}

/** The YAML front matter of a markdown file ("" when it has none). */
function frontMatter(file: string): string {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(fs.readFileSync(file, 'utf-8'));
  return m ? m[1] : '';
}

/** A relative symlink at p to target, between the real paths (/var is /private/var on macOS). */
function link(target: string, p: string): void {
  fs.symlinkSync(path.relative(fs.realpathSync(path.dirname(p)), fs.realpathSync(target)), p);
}

function isLink(p: string): boolean {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
}

export function createSteering(project: Project, typeSteering: string, provider: 'gitlab' | 'github',
  extraSteering: string[] = [], sources?: string): Steering {
  return new Steering(project, [...BASE_STEERING, typeSteering, `${provider}.md`, ...extraSteering], sources);
}
