import { YamlFile } from 'projen';
import type { Project } from 'projen';
import type { PlannedStack } from './stack-plan';

/**
 * AWS Workshop Studio's contentspec.yaml, generated from `workshopStudio` in .projenrc.ts and the
 * stack plan, so the templates, their parameters and the regions can never drift from the CDK app.
 * Field reference: catalog.workshops.aws/docs/en-US/detailed-documentation/contentspec.
 */

/** Where Workshop Studio provides accounts: its own, or the customer's. */
export enum WorkshopAccountSource {
  WORKSHOP_STUDIO = 'workshop_studio',
  CUSTOMER_PROVIDED = 'customer_provided',
}

/** The regions Workshop Studio supports (its 17 standard commercial regions; no opt-in regions). */
export const WORKSHOP_STUDIO_REGIONS = [
  'eu-north-1', 'ap-south-1', 'eu-west-3', 'eu-west-2', 'eu-west-1', 'ap-northeast-3', 'ap-northeast-2', 'ap-northeast-1',
  'sa-east-1', 'ca-central-1', 'ap-southeast-1', 'ap-southeast-2', 'eu-central-1', 'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
] as const;
export type WorkshopStudioRegion = typeof WORKSHOP_STUDIO_REGIONS[number];

/** A region list as Workshop Studio takes it: required (the operator can't remove), recommended (pre-selected), optional. */
export interface WorkshopRegionChoice {
  readonly required?: WorkshopStudioRegion[];
  readonly recommended?: WorkshopStudioRegion[];
  readonly optional?: WorkshopStudioRegion[];
}

/** Where a workshop deploys unless it says otherwise: the regions multi-az-workshop runs events in. */
export const DEFAULT_DEPLOYABLE_REGIONS: readonly WorkshopStudioRegion[] = ['us-east-1', 'us-east-2', 'us-west-2', 'eu-west-1', 'ap-southeast-1', 'ap-southeast-2'];

export interface WorkshopStudioOptions {
  /** The guide's locales; `content/` has an `index.<lang>.md` per folder for each. @default ['en-US'] */
  readonly locales?: string[];
  /** @default [WORKSHOP_STUDIO, CUSTOMER_PROVIDED] */
  readonly accountSources?: WorkshopAccountSource[];
  /**
   * Where an event may deploy the templates: ONE region per event, picked by the operator. At most one
   * `required` (it pins the workshop to that region); offer two or more so an operator can move off a
   * region with trouble. Every stack's own `region` (where our test deploy goes) must be one of them.
   * @default { recommended: DEFAULT_DEPLOYABLE_REGIONS } (multi-az-workshop's)
   */
  readonly deployableRegions?: WorkshopRegionChoice;
  /** Regions participants may also use (nothing is deployed there; mostly read-only). */
  readonly accessibleRegions?: WorkshopRegionChoice;
  /** How many regions a participant can reach, 1..3 (us-east-1 is always reachable). @default 1 and 1 */
  readonly minAccessibleRegions?: number;
  readonly maxAccessibleRegions?: number;
  /**
   * The participant role's policies: JSON files under static/ (magic variables such as
   * `{{.AccountId}}` allowed). The participant has NO permissions without one. @default ['static/iam_policy.json']
   */
  readonly participantPolicies?: string[];
  /** AWS-managed policy ARNs for the participant role (at most 8 policies with participantPolicies). */
  readonly managedPolicies?: string[];
  /** Service principals that may assume the participant role (e.g. `ec2.amazonaws.com`). */
  readonly trustedServices?: string[];
  /** Service-linked roles Workshop Studio creates before the templates run (never in the templates). */
  readonly serviceLinkedRoles?: string[];
  /** Create `ws-default-keypair` (WorkshopStudioMagic.EC2_KEY_PAIR_NAME). @default false */
  readonly ec2KeyPair?: boolean;
  /** Links in the guide's navigation. */
  readonly additionalLinks?: Array<{ readonly title: string; readonly link: string }>;
  /** Values the guide reads with `:param{key=...}`. */
  readonly params?: Record<string, unknown>;
  /** Show every stack output to participants (default: hidden; operators always see them). @default false */
  readonly participantAllStackOutputsVisible?: boolean;
}

/** Workshop Studio's limits a generated contentspec must stay inside (docs: event limits, contentspec). */
export const MAX_TEMPLATES = 5;
export const MAX_PARTICIPANT_POLICIES = 8;
const LABEL = /^[A-Za-z][A-Za-z0-9_\-\s]*$/;
const MANAGED_POLICY = /^arn:aws:iam::aws:policy\/\S+$/;
const STATIC_JSON = /^static\/[^\s]+\.json$/;

/** Where the build puts each top-level template for Workshop Studio (contentspec's templateLocation). */
export const templateLocation = (stackId: string) => `static/${stackId}.json`;

/**
 * The contentspec.yaml document, or an error naming what Workshop Studio would refuse. Every stack
 * becomes a team-account template, in deploy order; its parameters are the assets bucket and prefix
 * (every CreStack's) and its magic ones. A stack parameter with any other source has no value in
 * Workshop Studio, which passes nothing between templates: refused.
 */
export function contentspec(opts: WorkshopStudioOptions, stacks: readonly PlannedStack[]): Record<string, unknown> {
  const problems: string[] = [];
  if (stacks.length > MAX_TEMPLATES) problems.push(`${stacks.length} stacks: Workshop Studio deploys at most ${MAX_TEMPLATES} templates; nest the rest (NestedStack).`);
  const regions = new Set(stacks.map((s) => s.region));
  if (regions.size > 1) problems.push(`stacks in ${[...regions].join(', ')}: Workshop Studio deploys every template to the one region an event picks; give every stack the same region.`);
  const deployableRegions = opts.deployableRegions ?? { recommended: [...DEFAULT_DEPLOYABLE_REGIONS] };
  const { required = [], recommended = [], optional = [] } = deployableRegions;
  const deployable = [...required, ...recommended, ...optional];
  if (!deployable.length) problems.push('deployableRegions names no region.');
  if ((deployableRegions.required ?? []).length > 1) problems.push('deployableRegions.required: at most one region.');
  for (const r of [...deployable, ...Object.values(opts.accessibleRegions ?? {}).flat()]) {
    if (!(WORKSHOP_STUDIO_REGIONS as readonly string[]).includes(r)) problems.push(`region ${r}: not one of Workshop Studio's regions.`);
  }
  for (const s of stacks) if (!deployable.includes(s.region as WorkshopStudioRegion)) problems.push(`${s.id} deploys (in our test account) to ${s.region}, which deployableRegions doesn't offer.`);
  const min = opts.minAccessibleRegions ?? 1;
  const max = opts.maxAccessibleRegions ?? 1;
  if (!(min >= 1 && max <= 3 && min <= max)) problems.push(`minAccessibleRegions ${min} / maxAccessibleRegions ${max}: 1 <= min <= max <= 3.`);
  const policies = opts.participantPolicies ?? ['static/iam_policy.json'];
  for (const p of policies) if (!STATIC_JSON.test(p)) problems.push(`participantPolicies: ${p} must be a .json file under static/.`);
  for (const p of opts.managedPolicies ?? []) if (!MANAGED_POLICY.test(p)) problems.push(`managedPolicies: ${p} is not an AWS-managed policy ARN (arn:aws:iam::aws:policy/...).`);
  if (!policies.length && !(opts.managedPolicies ?? []).length) problems.push('the participant role gets no policy: Workshop Studio refuses the build.');
  if (policies.length + (opts.managedPolicies ?? []).length > MAX_PARTICIPANT_POLICIES) problems.push(`more than ${MAX_PARTICIPANT_POLICIES} participant policies.`);

  const templates = stacks.map((s) => {
    if (!LABEL.test(s.id)) problems.push(`${s.id}: not a Workshop Studio template label (a letter, then letters, digits, _ - or spaces).`);
    const parameters = [
      { templateParameter: 'AssetsBucketName', defaultValue: '{{.AssetsBucketName}}' },
      { templateParameter: 'AssetsBucketPrefix', defaultValue: '{{.AssetsBucketPrefix}}' },
    ];
    for (const [name, src] of Object.entries(s.parameters)) {
      const magic = src.kind === 'env' ? src.magic : undefined;
      if (!magic) {
        problems.push(`${s.id}: parameter ${name} takes ${src.kind === 'output' ? `${src.stack}'s output` : `deploy variable ${src.variable}`}, ` +
          'which Workshop Studio can\'t pass: give it a default, or take a Workshop Studio value (CreCfnParameter fromMagic).');
        continue;
      }
      parameters.push({ templateParameter: name, defaultValue: `{{.${magic}}}` });
    }
    return {
      templateLocation: templateLocation(s.id),
      label: s.id,
      parameters,
      ...(opts.participantAllStackOutputsVisible ? { participantAllStackOutputsVisible: true } : {}),
    };
  });
  if (problems.length) throw new Error(`workshopStudio: ${problems.join(' ')}`);

  const choice = (c: WorkshopRegionChoice) => Object.fromEntries(Object.entries(c).filter(([, v]) => v && v.length));
  const locales = opts.locales ?? ['en-US'];
  return {
    // A string: the number 2.0 is written `2`, which Workshop Studio refuses ("valid: [1.0 2.0]").
    version: '2.0',
    defaultLocaleCode: locales[0],
    localeCodes: locales,
    ...(opts.params ? { params: opts.params } : {}),
    ...(opts.additionalLinks?.length ? { additionalLinks: opts.additionalLinks } : {}),
    awsAccountConfig: {
      accountSources: opts.accountSources ?? [WorkshopAccountSource.WORKSHOP_STUDIO, WorkshopAccountSource.CUSTOMER_PROVIDED],
      ...(opts.serviceLinkedRoles?.length ? { serviceLinkedRoles: opts.serviceLinkedRoles } : {}),
      participantRole: {
        ...(policies.length ? { iamPolicies: policies } : {}),
        ...(opts.managedPolicies?.length ? { managedPolicies: opts.managedPolicies } : {}),
        ...(opts.trustedServices?.length ? { trustedPrincipals: { service: opts.trustedServices } } : {}),
      },
      ...(opts.ec2KeyPair ? { ec2KeyPair: true } : {}),
      regionConfiguration: {
        minAccessibleRegions: min,
        maxAccessibleRegions: max,
        ...(opts.accessibleRegions ? { accessibleRegions: choice(opts.accessibleRegions) } : {}),
        deployableRegions: choice(deployableRegions),
      },
    },
    infrastructure: { cloudformationTemplates: templates },
  };
}

/** Write contentspec.yaml at the repository root, where Workshop Studio and its build tool read it. */
export function createContentspec(project: Project, opts: WorkshopStudioOptions, stacks: readonly PlannedStack[]): void {
  new YamlFile(project, 'contentspec.yaml', { obj: contentspec(opts, stacks), readonly: true });
}
