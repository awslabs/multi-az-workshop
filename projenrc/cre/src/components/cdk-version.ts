import * as fs from 'fs';
import * as path from 'path';
import { Component, Project } from 'projen';
import { VERSIONS_FILE } from './build-tasks';

/**
 * aws-cdk-lib stays pinned to one exact version (a CDK release once dropped a fix the one before
 * had), and the version lives in build/versions.json as an `npm-package` entry. projen's npm upgrade
 * never moves a pinned package, so the scheduled upgrade's version lookups (versions:update) move
 * this entry instead, the next `npx projen` writes the new pin into package.json, and the change
 * lands as the upgrade's PR/MR: built and tested before it merges, like any other.
 */
export const CDK_PACKAGE = 'aws-cdk-lib';
/** The entry a project without one is given, and the version it starts from. */
export const CDK_ENTRY = 'aws-cdk-lib';
export const DEFAULT_CDK_VERSION = '2.248.0';

type Entry = { kind?: string; package?: string; version?: string };

function readDoc(outdir: string): Record<string, Entry> | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(outdir, VERSIONS_FILE), 'utf-8'));
  } catch {
    return undefined;
  }
}

const cdkEntry = (doc: Record<string, Entry> | undefined): Entry | undefined =>
  Object.values(doc ?? {}).find((e) => e?.kind === 'npm-package' && e.package === CDK_PACKAGE);

/** The aws-cdk-lib version the project pins: its versions.json entry's, else the default. */
export function cdkVersion(outdir: string): string {
  return cdkEntry(readDoc(outdir))?.version || DEFAULT_CDK_VERSION;
}

/** Adds the aws-cdk-lib entry to build/versions.json when the project has none (commit the file). */
export class CdkVersionEntry extends Component {
  constructor(project: Project, private readonly version: string) {
    super(project);
  }

  public override synthesize(): void {
    const file = path.join(this.project.outdir, VERSIONS_FILE);
    const doc = readDoc(this.project.outdir);
    if (fs.existsSync(file) && doc === undefined) return; // unreadable: versions:check names it
    if (cdkEntry(doc)) return;
    const next = { ...(doc ?? {}) };
    next[CDK_ENTRY] = {
      kind: 'npm-package',
      package: CDK_PACKAGE,
      version: this.version,
      update: 'minor',
      note: 'the project type pins aws-cdk-lib to this version (cdkVersion); the scheduled upgrade moves it',
    } as Entry;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
    this.project.logger.info(`cre: added the ${CDK_ENTRY} entry to ${VERSIONS_FILE} (commit it).`);
  }
}
