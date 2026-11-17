import * as fs from 'fs';
import * as path from 'path';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { CreStack } from './cre-stack.js';

/**
 * The project's version file, `build/versions.json`: every externally sourced version the project
 * deploys, which the weekly upgrade moves (projen's `versions:update`; the kinds and their lookups
 * are in the steering, cre-versions.md). Code reads a version from here, never from a literal, an
 * SSM-typed parameter or a service default, so a new version arrives only as a reviewed change to
 * this file, which then deploys.
 *
 *     const versions = CreVersions.of(this);
 *     new eks.Addon(this, 'CoreDns', { cluster, ...versions.addon('coredns') });
 *     new ec2.Instance(this, 'Host', { machineImage: versions.machineImage(this, 'appAmi'), ... });
 *
 * Each read names the kind it expects, so an entry used for the wrong thing fails the synth. The
 * build's `versions:check` validates the whole file; this only reads it.
 */
export type CreVersionKind =
  | 'eks-kubernetes' | 'eks-addon' | 'eks-node-ami' | 'ec2-ami' | 'rds-engine'
  | 'helm-chart' | 'container-image' | 'github-release' | 'kubectl';

/** One entry, as the file holds it. */
export interface CreVersionEntry {
  readonly kind: CreVersionKind;
  readonly version: string;
  readonly update: 'none' | 'patch' | 'minor' | 'major';
  readonly note?: string;
  /** eks-addon: the add-on's name. */
  readonly addon?: string;
  /** ec2-ami: region -> AMI id. */
  readonly ids?: Readonly<Record<string, string>>;
  /** ec2-ami: the public SSM parameter it is read from. */
  readonly parameter?: string;
  /** rds-engine: the engine. */
  readonly engine?: string;
  /** helm-chart: the chart repository and chart. */
  readonly repo?: string;
  readonly chart?: string;
  /** container-image: the image, without its tag. */
  readonly image?: string;
}

/** Where the file is, from the project root (the CDK app's working directory). */
export const CRE_VERSIONS_FILE = path.join('build', 'versions.json');

const loaded = new WeakMap<Construct, CreVersions>();

export class CreVersions {
  /**
   * The app's version file (`build/versions.json` under the working directory, or the cdk.json
   * context `cre:versionsFile`), read once per app.
   */
  public static of(scope: Construct): CreVersions {
    const root = scope.node.root;
    let v = loaded.get(root);
    if (!v) {
      const file = (root.node.tryGetContext('cre:versionsFile') as string | undefined) ?? CRE_VERSIONS_FILE;
      v = CreVersions.fromFile(path.resolve(file));
      loaded.set(root, v);
    }
    return v;
  }

  /** A version file at `file`. */
  public static fromFile(file: string): CreVersions {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf-8');
    } catch {
      throw new Error(`CreVersions: no version file at ${file}. Every externally sourced version lives in ${CRE_VERSIONS_FILE} ` +
        '(the steering cre-versions.md says how to add an entry).');
    }
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch (e) {
      throw new Error(`CreVersions: ${file} is not valid JSON (${(e as Error).message}).`);
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error(`CreVersions: ${file} must be an object of named entries.`);
    return new CreVersions(file, doc as Record<string, CreVersionEntry>);
  }

  private constructor(private readonly file: string, private readonly entries: Readonly<Record<string, CreVersionEntry>>) {}

  /** The entry `name`, which must be of `kind`. */
  public entry(name: string, kind: CreVersionKind): CreVersionEntry {
    const e = this.entries[name];
    if (!e) {
      throw new Error(`CreVersions: ${this.file} has no entry '${name}'. Add it (kind ${kind}) and run npx projen versions:update to fill it in.`);
    }
    if (e.kind !== kind) throw new Error(`CreVersions: '${name}' in ${this.file} is a ${e.kind} entry, not ${kind}.`);
    if (typeof e.version !== 'string' || (!e.version && kind !== 'ec2-ami')) {
      throw new Error(`CreVersions: '${name}' in ${this.file} has no version.`);
    }
    return e;
  }

  /** The version of entry `name`, which must be of `kind`. */
  public version(name: string, kind: CreVersionKind): string {
    return this.entry(name, kind).version;
  }

  /** An eks-addon entry as `eks.Addon` / `CfnAddon` props: `{ addonName, addonVersion }`. */
  public addon(name: string): { addonName: string; addonVersion: string } {
    const e = this.entry(name, 'eks-addon');
    return { addonName: e.addon!, addonVersion: e.version };
  }

  /**
   * An ec2-ami entry as a machine image: a CfnMapping from region to AMI id, read with
   * `Fn::FindInMap` on `AWS::Region`, so the stack stays environment-agnostic and takes no SSM
   * parameter. The stack's deploy region must have an id in the entry (run versions:update after
   * adding a region). A Windows AMI parameter (`/aws/service/ami-windows-latest/...`) gives a
   * Windows image.
   */
  public machineImage(scope: Construct, name: string, props: ec2.GenericLinuxImageProps = {}): ec2.IMachineImage {
    const e = this.entry(name, 'ec2-ami');
    const ids = Object.fromEntries(Object.entries(e.ids ?? {}).filter(([, id]) => id));
    const stack = CreStack.of(scope);
    const region = stack instanceof CreStack ? stack.deployRegion : undefined;
    if (region && !ids[region]) {
      throw new Error(`CreVersions: '${name}' in ${this.file} has no AMI id for ${region}, where ${stack.stackName} deploys. ` +
        `Add "${region}": "" to its ids and run npx projen versions:update.`);
    }
    if (Object.keys(ids).length === 0) throw new Error(`CreVersions: '${name}' in ${this.file} has no AMI ids; run npx projen versions:update.`);
    return e.parameter?.includes('/ami-windows-latest/')
      ? ec2.MachineImage.genericWindows(ids, props)
      : ec2.MachineImage.genericLinux(ids, props);
  }
}
