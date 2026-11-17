// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as fs from 'fs';
import * as path from 'path';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

/**
 * The kinds of entry build/versions.json holds: each has a lookup in projenrc/cre/scripts/build/versions.py, which the
 * weekly upgrade (post-upgrade: versions:update) uses to move it to the newest version its
 * `update` range allows.
 */
export type VersionKind =
  | 'eks-kubernetes' | 'eks-addon' | 'eks-node-ami' | 'ec2-ami' | 'rds-engine'
  | 'helm-chart' | 'container-image' | 'github-release' | 'kubectl';

export interface VersionEntry {
  readonly kind: VersionKind;
  readonly version: string;
  readonly update: 'none' | 'patch' | 'minor' | 'major';
  readonly note?: string;
  readonly addon?: string;
  readonly ids?: Readonly<Record<string, string>>;
  readonly parameter?: string;
  readonly engine?: string;
  readonly image?: string;
}

/** build/versions.json, from the repository root. */
export const VERSIONS_FILE = path.join(__dirname, '..', '..', '..', 'build', 'versions.json');

/**
 * Every externally sourced version the workshop deploys, read from build/versions.json. Code reads a
 * version from here, never from a literal, an SSM-typed parameter or a service default, so a new
 * version arrives only as a reviewed change to that file (which deploys). Each read names the kind
 * it expects, so an entry used for the wrong thing fails the synth.
 */
export class Versions {
  public static load(file: string = VERSIONS_FILE): Versions {
    return new Versions(file, JSON.parse(fs.readFileSync(file, 'utf-8')));
  }

  private constructor(private readonly file: string, private readonly entries: Readonly<Record<string, VersionEntry>>) {}

  public entry(name: string, kind: VersionKind): VersionEntry {
    const e = this.entries[name];
    if (!e) throw new Error(`${this.file} has no entry '${name}' (kind ${kind}); add it and run npx projen versions:update.`);
    if (e.kind !== kind) throw new Error(`'${name}' in ${this.file} is a ${e.kind} entry, not ${kind}.`);
    return e;
  }

  public version(name: string, kind: VersionKind): string {
    return this.entry(name, kind).version;
  }

  /** An eks-addon entry as add-on props. */
  public addon(name: string): { addonName: string; addonVersion: string } {
    const e = this.entry(name, 'eks-addon');
    return { addonName: e.addon!, addonVersion: e.version };
  }

  /**
   * An ec2-ami entry as a machine image: a region mapping read with Fn::FindInMap on AWS::Region,
   * so the template stays region-agnostic and takes no SSM-typed parameter.
   */
  public machineImage(name: string): ec2.IMachineImage {
    const ids = Object.fromEntries(Object.entries(this.entry(name, 'ec2-ami').ids ?? {}).filter(([, id]) => id));
    if (Object.keys(ids).length === 0) throw new Error(`'${name}' in ${this.file} has no AMI ids; run npx projen versions:update.`);
    return ec2.MachineImage.genericLinux(ids);
  }
}
