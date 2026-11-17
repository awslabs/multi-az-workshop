import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JsonFile } from 'projen';
import type { Project } from 'projen';
import { jobRecord, jobSpec, reservedVariable } from './stack-jobs';
import type { StackJob } from './stack-jobs';

/**
 * The project's stacks come from its CDK app. Every top-level stack is a `CreStack` that states
 * how the pipeline deploys it (`region`, `dependsOn`, `assumeRole`, `executionRole`), and every
 * parameter the pipeline passes is a `CreCfnParameter` that records its source (another stack's
 * output, or a deploy variable). `CreApp` writes all of it to `cdk.out/cre-stacks.json` when it
 * synthesizes.
 *
 * `npx projen` synthesizes the app first (no bundling, no asset staging: CRE_PLAN_SYNTH=1), reads
 * that file, validates it here, writes the committed `cre-stacks.json`, and generates the pipeline
 * from it. When the app can't be synthesized yet (no node_modules, no cdk.json on a fresh clone, or
 * a compile error) it uses the committed `cre-stacks.json` and says so.
 */

/** One stack as CreApp records it (constructs/src/core/cre-stack.ts CrePlannedStack). */
export interface SynthesizedStack {
  readonly id: string;
  readonly region: string;
  /** `iam`, `dns` or `edge` for the stacks with placement rules. */
  readonly kind?: string;
  readonly assumeRole?: string;
  readonly executionRole?: string;
  /** The stacks it deploys after, by id: its dependsOn and every stack it takes an output from. */
  readonly dependsOn: string[];
  readonly parameters: Record<string, SynthesizedParameter>;
  /** The outputs later stacks take. */
  readonly outputs: string[];
}

export type SynthesizedParameter =
  | { readonly kind: 'output'; readonly stack: string; readonly output: string }
  | { readonly kind: 'env'; readonly variable: string; readonly optional: boolean; readonly noEcho?: boolean; readonly magic?: string };

/** The partitions a project can deploy to. */
export type CrePartition = 'aws' | 'aws-us-gov' | 'aws-cn' | 'aws-eusc';

/**
 * Where a partition's IAM control plane runs (IAM is per partition, one control-plane region each):
 * the only region a CreIamStack deploys to. One fixed region per partition keeps account-wide IAM
 * outside any regional failover stack.
 */
export const IAM_CONTROL_PLANE_REGION: Record<CrePartition, string> = {
  'aws': 'us-east-1',
  'aws-us-gov': 'us-gov-west-1',
  'aws-cn': 'cn-north-1',
  'aws-eusc': 'eusc-de-east-1',
};

/** Where a partition's Route 53 control plane runs: the only region a CreDnsStack deploys to. */
export const DNS_CONTROL_PLANE_REGION: Record<CrePartition, string> = {
  'aws': 'us-east-1',
  'aws-us-gov': 'us-gov-west-1',
  'aws-cn': 'cn-northwest-1',
  'aws-eusc': 'eusc-de-east-1',
};

/** The partition a region name belongs to. */
export function partitionOf(region: string): CrePartition {
  if (region.startsWith('us-gov-')) return 'aws-us-gov';
  if (region.startsWith('cn-')) return 'aws-cn';
  if (region.startsWith('eusc-')) return 'aws-eusc';
  return 'aws';
}

/** The role environment variable a stack deploys with. */
export interface RoleVariable {
  readonly variable: string;
  readonly optional: boolean;
}

/** A parameter's source, resolved. */
export type ParameterSource =
  | { readonly kind: 'output'; readonly stack: string; readonly output: string }
  | { readonly kind: 'env'; readonly variable: string; readonly optional: boolean; readonly noEcho?: boolean; readonly magic?: string }
  | { readonly kind: 'literal'; readonly value: string };

export interface PlannedStack {
  /** The deployed stack name: the CreStack's construct id. */
  readonly id: string;
  readonly region: string;
  readonly kind?: string;
  /** The role assumed before deploying, if any. */
  readonly assumeRole?: RoleVariable;
  /** CloudFormation's service role. */
  readonly executionRole: RoleVariable;
  /** Every parameter the deploy passes; output sources name the producing stack by id. */
  readonly parameters: Record<string, ParameterSource>;
  readonly outputs: string[];
  /** The dotenv prefix its outputs are written under (`<PREFIX>_<OUTPUT>`). */
  readonly outputsPrefix: string;
  /** The stacks (ids) its deploy job needs, in deploy order. */
  readonly needs: string[];
}

/** A region name. crelib.py's REGION_RE and the construct library's REGION_NAME are the same (a test keeps them so). */
export const REGION = /^[a-z]{2,4}(-[a-z]+)+-\d+$/;
const ENV = /^\$([A-Z_][A-Z0-9_]*)(\?)?$/;
/** CloudFront (and CloudFront Signer) exist only in the commercial partition. */
const COMMERCIAL_ONLY_KINDS = new Set(['edge']);
/**
 * GitLab carries a job's outputs as a dotenv artifact. Its `dotenv_variables` plan limit defaults
 * to 20 on self-managed GitLab (gitlab.aws.dev allows more: a probe passed 150), so 20 is the
 * floor every instance meets.
 */
const MAX_OUTPUTS = 20;

/**
 * Validate the synthesized stacks and put them in deploy order: every stack after the stacks it
 * depends on, otherwise in the order the app created them. Throws on the first problem, naming it.
 */
export function planStacks(projectName: string, stacks: readonly SynthesizedStack[], partition: CrePartition = 'aws'): PlannedStack[] {
  const byId = new Map<string, SynthesizedStack>();
  const byFolded = new Map<string, string>();
  for (const s of stacks) {
    if (byId.has(s.id)) throw new Error(`stack ${s.id}: created twice.`);
    byId.set(s.id, s);
    // Its outputs travel as STACK_<ID>_<OUTPUT> (upper case) and its GitHub job id ignores case:
    // two names that differ only in case would swap outputs or collide.
    const other = byFolded.get(s.id.toLowerCase());
    if (other) throw new Error(`stack ${s.id}: differs from stack ${other} only in case; rename one.`);
    byFolded.set(s.id.toLowerCase(), s.id);
    const outs = new Map<string, string>();
    for (const o of s.outputs) {
      const prev = outs.get(o.toUpperCase());
      if (prev && prev !== o) throw new Error(`stack ${s.id}: outputs ${prev} and ${o} differ only in case; rename one.`);
      outs.set(o.toUpperCase(), o);
    }
  }
  const checkName = (where: string, what: string, variable: string): void => {
    const why = reservedVariable(variable);
    if (why) throw new Error(`${where}: ${what} uses deploy variable ${variable}, a reserved name (${why}); choose another.`);
  };
  const roleVariable = (where: string, field: string, value: string): RoleVariable => {
    const m = ENV.exec(value);
    if (!m) throw new Error(`${where}: ${field} '${value}' must be '$VAR' or '$VAR?', the deploy variable holding the role ARN.`);
    checkName(where, field, m[1]);
    return { variable: m[1], optional: m[2] === '?' };
  };
  // Only the DNS account's deploy role can read the app account's bucket (assets.py's bucket policy
  // and GitHub's upload grant name DNS_ROLE_ARN), so any other role builds green and fails after
  // the merge (review 10i D2).
  const dnsRole = (where: string, r: RoleVariable): RoleVariable => {
    if (r.variable !== 'DNS_ROLE_ARN') {
      throw new Error(`${where}: assumeRole '$${r.variable}${r.optional ? '?' : ''}' must be '$DNS_ROLE_ARN' or '$DNS_ROLE_ARN?': ` +
        'a stack deploys in another account only as the DNS account\'s deploy role (setup:aws --dns-profile).');
    }
    return r;
  };
  for (const s of stacks) {
    const where = `stack ${s.id}`;
    if (s.id !== projectName && !s.id.startsWith(`${projectName}-`)) {
      throw new Error(`${where}: must be named '${projectName}' or '${projectName}-<name>' (app.stackId('<name>')).`);
    }
    if (!REGION.test(s.region)) throw new Error(`${where}: region '${s.region}' is not a region name like 'us-east-1'.`);
    if (partitionOf(s.region) !== partition) {
      throw new Error(`${where}: region ${s.region} is in partition ${partitionOf(s.region)}, not the project's ${partition}.`);
    }
    const fixed = s.kind === 'iam' ? IAM_CONTROL_PLANE_REGION[partition] : s.kind === 'dns' ? DNS_CONTROL_PLANE_REGION[partition] : undefined;
    if (fixed && s.region !== fixed) {
      throw new Error(`${where}: a ${s.kind === 'iam' ? 'CreIamStack' : 'CreDnsStack'} deploys only to ${fixed}, ` +
        `the ${s.kind === 'iam' ? 'IAM' : 'Route 53'} control-plane region in ${partition}.`);
    }
    if (s.kind && COMMERCIAL_ONLY_KINDS.has(s.kind) && partition !== 'aws') {
      throw new Error(`${where}: CloudFront and CloudFront Signer exist only in the aws partition, not ${partition}.`);
    }
    // CloudFront Signer reads its signing secret in us-east-1, and cfs:onboard reads the
    // distribution there (#34).
    if (s.kind === 'edge' && s.region !== 'us-east-1') {
      throw new Error(`${where}: a CreEdgeStack deploys only to us-east-1 (CloudFront Signer's region), not ${s.region}.`);
    }
    if (s.outputs.length > MAX_OUTPUTS) {
      throw new Error(`${where}: later stacks take ${s.outputs.length} of its outputs; a deploy job can pass at most ${MAX_OUTPUTS}: split the stack, or pass fewer values (one joined value instead of several).`);
    }
    for (const d of s.dependsOn) if (!byId.has(d)) throw new Error(`${where}: depends on ${d}, which the app doesn't create.`);
    for (const [name, src] of Object.entries(s.parameters)) {
      if (src.kind === 'env') checkName(where, `parameter ${name}`, src.variable);
      if (src.kind !== 'output') continue;
      const from = byId.get(src.stack);
      if (!from) throw new Error(`${where}: parameter ${name} takes output ${src.output} of ${src.stack}, which the app doesn't create.`);
      if (!from.outputs.includes(src.output)) throw new Error(`${where}: parameter ${name}: ${src.stack} doesn't record output ${src.output}.`);
    }
  }

  // Deploy order: a stable topological sort (Kahn's algorithm, ties broken by creation order).
  const ordered: SynthesizedStack[] = [];
  const done = new Set<string>();
  while (ordered.length < stacks.length) {
    const next = stacks.find((s) => !done.has(s.id) && s.dependsOn.every((d) => done.has(d)));
    if (!next) throw new Error(describeCycle(stacks.filter((s) => !done.has(s.id))));
    ordered.push(next);
    done.add(next.id);
  }

  const position = new Map(ordered.map((s, i) => [s.id, i]));
  return ordered.map((s) => {
    const where = `stack ${s.id}`;
    return {
      id: s.id,
      region: s.region,
      kind: s.kind,
      assumeRole: s.assumeRole === undefined ? undefined : dnsRole(where, roleVariable(where, 'assumeRole', s.assumeRole)),
      executionRole: roleVariable(where, 'executionRole', s.executionRole ?? '$CFN_EXECUTION_ROLE_ARN'),
      parameters: { ...s.parameters },
      outputs: [...s.outputs],
      outputsPrefix: `STACK_${s.id.toUpperCase().replace(/-/g, '_')}`,
      needs: [...s.dependsOn].sort((a, b) => position.get(a)! - position.get(b)!),
    };
  });
}

/**
 * One cycle among the stacks a topological sort couldn't place, as `a → b → a`, with what makes
 * each edge (the parameter taking the other's output, or dependsOn). The stacks that only depend on
 * the cycle are left out (review 10c A14).
 */
function describeCycle(left: readonly SynthesizedStack[]): string {
  const byId = new Map(left.map((s) => [s.id, s]));
  const why = (from: SynthesizedStack, to: string) => {
    const params = Object.entries(from.parameters).filter(([, src]) => src.kind === 'output' && src.stack === to).map(([n]) => n);
    return params.length ? `parameter ${params.join(', ')}` : 'dependsOn';
  };
  // Every leftover stack depends on another leftover one (else the sort would have placed it), so
  // walking dependencies from any of them must revisit one: that loop is the cycle.
  const trail: string[] = []; // not `path`: that shadows the import, which projects' eslint refuses
  let at = left[0].id;
  while (!trail.includes(at)) {
    trail.push(at);
    at = byId.get(at)!.dependsOn.find((d) => byId.has(d))!;
  }
  const cycle = [...trail.slice(trail.indexOf(at)), at];
  const steps = cycle.slice(0, -1).map((id, i) => `${id} → ${cycle[i + 1]} (${why(byId.get(id)!, cycle[i + 1])})`);
  return `stacks depend on each other in a cycle: ${steps.join(', ')}. Break one edge: a value that goes both ways belongs in one ` +
    'stack, or a third stack both read from.';
}

/** Where the committed plan lives, at the project root. */
export const PLAN_FILE = 'cre-stacks.json';

/** What the CDK CLI prints, exiting 1, when the app synthesizes no stacks (a fresh scaffold). */
export const NO_STACKS = 'This app contains no stacks';

export interface ReadPlanResult {
  readonly stacks: SynthesizedStack[];
  /** Where they came from, for the message `npx projen` prints. */
  readonly source: 'synth' | 'committed' | 'none';
  readonly detail?: string;
  /** The app ran and failed (a compile or synth error), as opposed to not being runnable yet. */
  readonly failed?: boolean;
}

/**
 * The command projen writes to cdk.json's `app` for this entrypoint (AwsCdkTypeScriptApp with
 * yarn: `npx ts-node -P <tsconfig> --prefer-ts-exts <srcdir>/<entrypoint>`). A test pins the two
 * together, so a projen upgrade that changes its form fails there rather than synthesizing the wrong app.
 */
export function cdkAppCommand(srcdir: string, appEntrypoint: string, tsconfig?: string): string {
  return `npx ts-node${tsconfig ? ` -P ${tsconfig}` : ''} --prefer-ts-exts ${path.posix.join(srcdir, appEntrypoint)}`;
}

/**
 * The app's stacks: from a plan-only `cdk synth` of the app when it can run, else from the
 * committed cre-stacks.json. `CRE_SKIP_PLAN_SYNTH=1` skips the synth (tests, or to regenerate
 * from the committed plan only).
 */
export function readPlan(outdir: string, projectName: string, app?: string): ReadPlanResult {
  const committed = (): ReadPlanResult => {
    const file = path.join(outdir, PLAN_FILE);
    if (!fs.existsSync(file)) return { stacks: [], source: 'none' };
    return { stacks: JSON.parse(fs.readFileSync(file, 'utf-8')).synthesized ?? [], source: 'committed' };
  };
  const cdk = path.join(outdir, 'node_modules', '.bin', 'cdk');
  if (process.env.CRE_SKIP_PLAN_SYNTH === '1' || !fs.existsSync(cdk) || !fs.existsSync(path.join(outdir, 'cdk.json'))) {
    return committed();
  }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cre-plan-'));
  try {
    // The project name and the app command on the command line too: cdk.json gets them in this same
    // run, too late for this synth. Without `--app`, a project whose entrypoint just moved (a project
    // converted to a CRE type, or to another layout) would synth the old app from the old cdk.json.
    const args = ['synth', '--quiet', '--no-notices', ...(app ? ['--app', app] : []),
      '--context', `cre:projectName=${projectName}`, '--output', out];
    execFileSync(cdk, args, {
      cwd: outdir,
      env: { ...process.env, CRE_PLAN_SYNTH: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const file = path.join(out, PLAN_FILE);
    if (!fs.existsSync(file)) {
      return { ...committed(), detail: `the app wrote no ${PLAN_FILE} (is it a CreApp?)` };
    }
    return { stacks: JSON.parse(fs.readFileSync(file, 'utf-8')).stacks, source: 'synth' };
  } catch (e) {
    const stderr = String((e as { stderr?: Buffer }).stderr ?? e).trim().split('\n').slice(-15).join('\n');
    // The CDK CLI refuses an app with no stacks (exit 1, "This app contains no stacks") after the
    // app ran and wrote its (empty) plan: a fresh scaffold, not a failure.
    const file = path.join(out, PLAN_FILE);
    if (stderr.includes(NO_STACKS) && fs.existsSync(file)) {
      return { stacks: JSON.parse(fs.readFileSync(file, 'utf-8')).stacks, source: 'synth' };
    }
    return { ...committed(), detail: `cdk synth failed:\n${stderr}`, failed: true };
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

/** The plan as written to cre-stacks.json: what the app declared, the deploy order, and every job. */
export function planJson(
  synthesized: readonly SynthesizedStack[],
  planned: readonly PlannedStack[],
  jobs: readonly StackJob[],
  defaults: Readonly<Record<string, string>> = {},
) {
  const env = planEnvironment(planned, defaults);
  return {
    // Exactly what CreApp wrote; check:stack-plan compares it with every synth.
    synthesized,
    environment: env,
    // Deploy order.
    stacks: planned.map((p) => ({
      id: p.id,
      region: p.region,
      ...(p.kind ? { kind: p.kind } : {}),
      assumeRole: p.assumeRole,
      executionRole: p.executionRole,
      parameters: p.parameters,
      outputs: p.outputs,
      needs: p.needs,
    })),
    // Each stack's deploy job: its needs and every variable it gets (rendered for GitLab, and as
    // the structured spec the local deploy renders).
    jobs: Object.fromEntries(jobs.map((j) => [j.stack.id, { ...jobRecord(j), spec: jobSpec(j) }])),
  };
}

export function writePlanFile(
  project: Project,
  synthesized: readonly SynthesizedStack[],
  planned: readonly PlannedStack[],
  jobs: readonly StackJob[],
  defaults: Readonly<Record<string, string>> = {},
): void {
  new JsonFile(project, PLAN_FILE, { obj: planJson(synthesized, planned, jobs, defaults), readonly: true, marker: false });
}

/**
 * Every deploy environment variable the stacks name (parameters and roles), split into required
 * (`$VAR`), optional (`$VAR?`) and defaulted (the deploy supplies a value when it is unset, e.g.
 * `BINDLE_ID`).
 */
export function planEnvironment(
  planned: readonly PlannedStack[],
  defaults: Readonly<Record<string, string>> = {},
): { required: string[]; optional: string[]; defaulted: string[] } {
  const required = new Set<string>();
  const optional = new Set<string>();
  const add = (v: { variable: string; optional: boolean }) => (v.optional ? optional : required).add(v.variable);
  for (const p of planned) {
    if (p.assumeRole) add(p.assumeRole);
    add(p.executionRole);
    // An empty optional execution role falls back to CFN_EXECUTION_ROLE_ARN.
    if (p.executionRole.optional) required.add('CFN_EXECUTION_ROLE_ARN');
    for (const src of Object.values(p.parameters)) if (src.kind === 'env') add(src);
  }
  for (const v of required) optional.delete(v);
  const defaulted = [...required, ...optional].filter((v) => defaults[v] !== undefined);
  for (const v of defaulted) { required.delete(v); optional.delete(v); }
  return { required: [...required], optional: [...optional], defaulted };
}
