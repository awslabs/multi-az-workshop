import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Aws } from 'aws-cdk-lib';
import * as cxapi from 'aws-cdk-lib/cx-api';
import { Construct } from 'constructs';
import { FunctionLogGroups } from './function-log-groups.js';
import { REGION_NAME, unknownRegion } from './names.js';

/** The ECR repository a project's container images go to, in each region it deploys to. Never
 * CDK's shared bootstrap repository: the project's runner role may push only here. */
export function creImageRepository(project: string): string {
  return `cre/${project}`;
}

/**
 * The synthesizer every CRE stack uses. The deploy publishes each template and its assets to
 * `s3://<AssetsBucketName>/<AssetsBucketPrefix>` and CloudFormation reads them from there, so the
 * `${AssetsBucketName}` / `${AssetsBucketPrefix}` placeholders are substituted by the packaging step
 * (projenrc/cre/scripts/build/package.py) before deploy. Container images go to the project's own
 * repository, {@link creImageRepository}. No bootstrap version rule (nothing is bootstrapped). One
 * per stack: CDK mutates synthesizers during synth, so they can't be shared.
 *
 * `project` is the cdk.json context `cre:projectName` (projen writes it). Without it a stack still
 * synthesizes, but a container image refuses: there is no repository to name.
 */
export function creSynthesizer(project?: string): cdk.IStackSynthesizer {
  return new CreSynthesizer(project);
}

class CreSynthesizer extends cdk.DefaultStackSynthesizer {
  private readonly project?: string;

  constructor(project?: string) {
    super({
      fileAssetsBucketName: '${AssetsBucketName}',
      bucketPrefix: '${AssetsBucketPrefix}',
      imageAssetsRepositoryName: creImageRepository(project ?? 'no-project-name'),
      qualifier: undefined,
      generateBootstrapVersionRule: false,
    });
    this.project = project;
  }

  public override addDockerImageAsset(asset: cdk.DockerImageAssetSource): cdk.DockerImageAssetLocation {
    if (!this.project) {
      throw new Error("A container image needs the project's ECR repository, named from the cdk.json context " +
        "'cre:projectName', which projen writes (run npx projen).");
    }
    return super.addDockerImageAsset(asset);
  }
}

const REGION = REGION_NAME;
const ROLE_VARIABLE = /^\$[A-Z_][A-Z0-9_]*\??$/;

/**
 * Stack props a CRE stack accepts: how the pipeline deploys it, plus CDK's stack props without
 * `env`, `stackName` or `synthesizer`. Every stack is environment-agnostic (code uses
 * `Aws.REGION`, `Aws.ACCOUNT_ID`, `Aws.PARTITION`, `Aws.URL_SUFFIX`), its name is its construct id,
 * and its synthesizer is {@link creSynthesizer}.
 *
 * The pipeline is generated from these: projen synthesizes the app, reads every CreStack's
 * deploy settings and parameters (cre-stacks.json), and writes one deploy job per stack.
 */
export interface CreStackProps extends Omit<cdk.StackProps, 'env' | 'stackName' | 'synthesizer'> {
  /**
   * The region the pipeline deploys this stack to: a literal region name in the project's
   * partition. Not the CDK `env`: the template stays region-agnostic, so inside the stack keep
   * using `Aws.REGION`.
   */
  readonly region: string;
  /**
   * Stacks this one deploys after even though it takes none of their outputs. A stack already
   * deploys after every stack a {@link CreCfnParameter} takes an output from; list only an
   * ordering that carries no data.
   */
  readonly dependsOn?: CreStack[];
  /**
   * The deploy variable holding the role this stack's CI job deploys as, for a stack in another
   * account: `'$VAR'` (must be set) or `'$VAR?'` (may be empty; empty deploys as the runner role,
   * RUNNER_ROLE_ARN). CI gives the job that role's credentials directly, never by role chaining.
   * @default the runner role
   */
  readonly assumeRole?: string;
  /**
   * The deploy variable holding CloudFormation's service role (`--role-arn`): `'$VAR'` or `'$VAR?'`
   * (empty falls back to CFN_EXECUTION_ROLE_ARN). @default '$CFN_EXECUTION_ROLE_ARN'
   */
  readonly executionRole?: string;
}

/** Where a parameter's value comes from in the pipeline (recorded by {@link CreCfnParameter}). */
export type CreParameterSource =
  | { readonly kind: 'output'; readonly stack: string; readonly output: string }
  | { readonly kind: 'env'; readonly variable: string; readonly optional: boolean; readonly noEcho?: boolean; readonly magic?: string };

/**
 * Base class for every top-level stack in a CRE project.
 *
 *   - Stack name = construct id (`$PROJECT_NAME`, `$PROJECT_NAME-edge`, ...): the id IS the
 *     deployed name, and the pipeline job is named after it. Use `app.stackId('edge')` for the
 *     project prefix.
 *   - Deploy settings ({@link CreStackProps}): `region` (required), `dependsOn`, `assumeRole`,
 *     `executionRole`. The pipeline is generated from them.
 *   - Every parameter the pipeline passes is a {@link CreCfnParameter}, which records its source;
 *     {@link CreApp} fails the synth on a parameter without a default that isn't one.
 *   - {@link creSynthesizer}, always (a `synthesizer` prop is refused).
 *   - Environment-agnostic, always (an `env` prop is refused). Refer to the stack's own location
 *     only through `Aws.REGION`, `Aws.ACCOUNT_ID`, `Aws.PARTITION`, `Aws.URL_SUFFIX`, never
 *     `Stack.of(this).region` or a literal, so the same template works in any partition.
 *   - Declares the `AssetsBucketName` and `AssetsBucketPrefix` parameters, which the deploy passes
 *     to every stack.
 *
 * Use it under a {@link CreApp}.
 */
export class CreStack extends cdk.Stack {
  public readonly assetsBucketName: cdk.CfnParameter;
  public readonly assetsBucketPrefix: cdk.CfnParameter;
  /** The region the pipeline deploys this stack to. */
  public readonly deployRegion: string;
  public readonly assumeRole?: string;
  public readonly executionRole?: string;
  /** Parameter sources, by parameter name (filled by CreCfnParameter). */
  public readonly parameterSources = new Map<string, CreParameterSource>();
  /** Outputs other stacks take, in the order they were first requested. */
  public readonly consumedOutputs: string[] = [];
  private readonly deployAfter = new Set<CreStack>();

  constructor(scope: Construct, id: string, props: CreStackProps) {
    const raw = (props ?? {}) as cdk.StackProps & Partial<CreStackProps>;
    if (raw.env !== undefined) {
      throw new Error(`CreStack ${id}: no env. CRE stacks are environment-agnostic: set the deploy region with the region prop; ` +
        'inside the stack use Aws.REGION / ACCOUNT_ID / PARTITION / URL_SUFFIX.');
    }
    if (raw.synthesizer !== undefined || raw.stackName !== undefined) {
      throw new Error(`CreStack ${id}: no synthesizer or stackName. Every CRE stack uses creSynthesizer() and is named by its id.`);
    }
    if (typeof raw.region !== 'string' || cdk.Token.isUnresolved(raw.region)) {
      throw new Error(`CreStack ${id}: region must be a literal region name like 'us-east-1' (the region the pipeline deploys it to), not a token.`);
    }
    // A literal that isn't shaped like a region (us-east2) is a typo: say which region it is near
    // (review 10d A7), as for a well-shaped unknown one.
    const unknown = REGION.test(raw.region) ? unknownRegion(raw.region) : unknownRegion(raw.region) ?? `'${raw.region}' is not a region name`;
    if (unknown) throw new Error(`CreStack ${id}: region ${unknown}`);
    for (const [field, value] of [['assumeRole', raw.assumeRole], ['executionRole', raw.executionRole]] as const) {
      if (value !== undefined && !ROLE_VARIABLE.test(value)) {
        throw new Error(`CreStack ${id}: ${field} '${value}' must be '$VAR' or '$VAR?', the deploy variable holding the role ARN.`);
      }
    }
    const { region, dependsOn, assumeRole, executionRole, ...stackProps } = raw;
    super(scope, id, { ...stackProps, stackName: id, synthesizer: creSynthesizer(scope.node.tryGetContext('cre:projectName')) });
    this.deployRegion = region;
    this.assumeRole = assumeRole;
    this.executionRole = executionRole;
    for (const d of dependsOn ?? []) this.deployAfter.add(d);
    this.assetsBucketName = new cdk.CfnParameter(this, 'AssetsBucketName', {
      type: 'String',
      description: 'S3 bucket holding the synthesized templates and asset objects.',
    });
    this.assetsBucketPrefix = new cdk.CfnParameter(this, 'AssetsBucketPrefix', {
      type: 'String',
      description: 'Key prefix inside AssetsBucketName (trailing slash required).',
    });
  }

  /** Deploy this stack after `stack` (CreCfnParameter calls it for the stacks it takes outputs from). */
  public deployAfterStack(stack: CreStack): void {
    if (stack === this) throw new Error(`CreStack ${this.stackName}: a stack can't depend on itself.`);
    this.deployAfter.add(stack);
  }

  /** The stacks this one deploys after: its `dependsOn` and every stack it takes an output from. */
  public get deployDependencies(): CreStack[] {
    return [...this.deployAfter];
  }

  /** `iam`, `dns`, `edge` for the stacks with placement rules (the plan checks their regions). */
  public get kind(): string | undefined {
    return this.creKind;
  }

  /** Set by CreIamStack / CreDnsStack / CreEdgeStack. */
  protected creKind?: string;
}

/**
 * Fail the deploy unless the stack is deployed in one of `regions`. A CloudFormation Rule on
 * `AWS::Region`: the stack stays environment-agnostic and the check holds wherever the template is
 * deployed from. CloudFormation accepts the change set and evaluates the Rule when it executes:
 * the stack fails with "Parameter validation failed: assertion error: ..." before any resource is
 * created. One per (stack, id).
 */
export function requireDeployRegion(scope: Construct, id: string, regions: readonly string[], why: string): cdk.CfnRule {
  const stack = cdk.Stack.of(scope);
  return (stack.node.tryFindChild(id) as cdk.CfnRule | undefined) ?? new cdk.CfnRule(stack, id, {
    assertions: [{
      assert: cdk.Fn.conditionContains([...regions], Aws.REGION),
      assertDescription: `${stack.stackName} must be deployed in ${regions.join(' or ')}: ${why}`,
    }],
  });
}

/** CDK metadata switches, set inside the app because the CLI refuses `aws:` context keys. */
const NO_CDK_METADATA = {
  'aws:cdk:enable-path-metadata': false,
  'aws:cdk:enable-asset-metadata': false,
  'aws:cdk:version-reporting': false,
};

/**
 * Set by projen when it synthesizes the app only to read the stacks (`CRE_PLAN_SYNTH=1`): no asset
 * bundling (no esbuild or Docker for Lambda code) and no asset staging (nothing copied into the
 * output). Container images are never built by a synth.
 */
const PLAN_ONLY = {
  [cxapi.BUNDLING_STACKS]: [],
  [cxapi.DISABLE_ASSET_STAGING_CONTEXT]: true,
};

/** The file CreApp writes next to the templates: every CreStack, as the pipeline deploys it. */
export const CRE_PLAN_FILE = 'cre-stacks.json';

/** One stack as recorded in {@link CRE_PLAN_FILE}. */
export interface CrePlannedStack {
  readonly id: string;
  readonly region: string;
  readonly kind?: string;
  readonly assumeRole?: string;
  readonly executionRole?: string;
  /** Every stack it deploys after (its dependsOn and the stacks it takes outputs from), by id. */
  readonly dependsOn: string[];
  readonly parameters: Record<string, CreParameterSource>;
  /** The outputs later stacks take. */
  readonly outputs: string[];
}

export type CreAppProps = Omit<cdk.AppProps, 'analyticsReporting'>;

/**
 * The app every CRE project's `app.ts` creates.
 *
 *   - No CDK metadata in any template: no `CDKMetadata` resource, no `aws:cdk:path` or
 *     `aws:asset:*` resource metadata (packaging reads `*.assets.json`, never the template).
 *   - Every top-level stack must be a {@link CreStack}, named `projectName` or
 *     `projectName-<suffix>` (`stackId()`), and every parameter it declares without a default must
 *     be a {@link CreCfnParameter}; anything else fails the synth.
 *   - Every Lambda function gets a log group its stack owns and deletes ({@link FunctionLogGroups}),
 *     so a teardown leaves no `/aws/lambda/*` groups behind.
 *   - Writes {@link CRE_PLAN_FILE} next to the templates: the stacks the pipeline deploys, their
 *     regions, roles, parameter sources, the outputs later stacks take, and the order. projen
 *     generates the pipeline from it.
 */
export class CreApp extends cdk.App {
  /** The project name (from cdk.json context `cre:projectName`, which projen writes). */
  public readonly projectName?: string;

  constructor(props: CreAppProps = {}) {
    super({
      ...props,
      analyticsReporting: false,
      postCliContext: {
        ...(props.postCliContext ?? {}),
        ...NO_CDK_METADATA,
        ...(process.env.CRE_PLAN_SYNTH === '1' ? PLAN_ONLY : {}),
      },
    });
    this.projectName = this.node.tryGetContext('cre:projectName');
    this.node.addValidation({ validate: () => this.problems() });
    cdk.Aspects.of(this).add(new FunctionLogGroups());
  }

  /** `stackId()` → the project name; `stackId('edge')` → `<project>-edge`. */
  public stackId(suffix?: string): string {
    if (!this.projectName) {
      throw new Error("CreApp.stackId: no project name; projen writes it to cdk.json context 'cre:projectName' (run npx projen).");
    }
    return suffix ? `${this.projectName}-${suffix}` : this.projectName;
  }

  /** The CreStacks of the app, in the order they were created. */
  public get creStacks(): CreStack[] {
    return this.node.children.filter((c): c is CreStack => c instanceof CreStack);
  }

  private problems(): string[] {
    const problems: string[] = [];
    for (const c of this.node.children) {
      if (cdk.Stack.isStack(c) && !(c instanceof CreStack)) {
        problems.push(`Top-level stack '${c.node.id}' must extend CreStack (from @cre/constructs): it sets the asset-bucket ` +
          'synthesizer and parameters every deploy needs, the deploy region, and keeps the stack environment-agnostic.');
      }
    }
    for (const s of this.creStacks) {
      if (this.projectName && s.stackName !== this.projectName && !s.stackName.startsWith(`${this.projectName}-`)) {
        problems.push(`Stack '${s.stackName}' must be named '${this.projectName}' or '${this.projectName}-<name>' ` +
          "(app.stackId('<name>')): the project's deploy roles are scoped to that prefix.");
      }
      // CloudFormation refuses a template with no resources ("At least one Resources member must be
      // defined"), and CDK adds none of its own here (no CDKMetadata), so say it at synth, not at deploy.
      if (!s.node.findAll().some((c) => c instanceof cdk.CfnResource && cdk.Stack.of(c) === s)) {
        problems.push(`${s.stackName}: the stack has no resources, which CloudFormation refuses at deploy. Add a ` +
          'resource, or delete the stack and take its value from where it is made.');
      }
      for (const p of s.node.findAll()) {
        if (!(p instanceof cdk.CfnParameter) || cdk.Stack.of(p) !== s) continue;
        const name = s.resolve(p.logicalId) as string;
        if (name === 'AssetsBucketName' || name === 'AssetsBucketPrefix' || s.parameterSources.has(name)) continue;
        if (p.default === undefined) {
          problems.push(`${s.stackName}: parameter ${name} has no default and no source. Declare it as a CreCfnParameter ` +
            "with `from` (another stack's value) or `fromVariable` (a deploy variable), or give it a default.");
        }
      }
    }
    return problems;
  }

  /** The plan: every CreStack, as the pipeline deploys it. */
  public plan(): CrePlannedStack[] {
    return this.creStacks.map((s) => ({
      id: s.stackName,
      region: s.deployRegion,
      ...(s.kind ? { kind: s.kind } : {}),
      ...(s.assumeRole ? { assumeRole: s.assumeRole } : {}),
      ...(s.executionRole ? { executionRole: s.executionRole } : {}),
      dependsOn: s.deployDependencies.map((d) => d.stackName),
      parameters: Object.fromEntries(s.parameterSources),
      outputs: [...s.consumedOutputs],
    }));
  }

  public override synth(options?: cdk.StageSynthesisOptions): cxapi.CloudAssembly {
    const assembly = super.synth(options);
    fs.writeFileSync(path.join(assembly.directory, CRE_PLAN_FILE), `${JSON.stringify({ stacks: this.plan() }, null, 2)}\n`);
    return assembly;
  }
}
