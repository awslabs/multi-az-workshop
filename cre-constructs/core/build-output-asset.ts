import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as s3_assets from 'aws-cdk-lib/aws-s3-assets';
import { Construct } from 'constructs';

/** Options for {@link buildOutputAsset}. */
export interface BuildOutputAssetOptions {
  /** The task that makes the file, named in the error when it's missing (e.g. `build:assets`). */
  readonly builtBy: string;
}

/**
 * An S3 asset of a file the project's build makes (a `docker save` tarball, a packaged Helm chart,
 * a downloaded binary), for `CreEcrImport` or anything else that takes an `s3_assets.Asset`.
 *
 * `npx projen` synthesizes the app to read its stacks (`CRE_PLAN_SYNTH=1`) before anything is built,
 * and CDK fingerprints an asset's file when it is created, so the file has to exist. That synth's
 * templates are thrown away, so it gets a placeholder file instead; so do unit tests (jest), always,
 * so a snapshot doesn't depend on whether this machine built the file. Any other synth (the build's,
 * the deploy's) without the file fails, naming `builtBy`.
 *
 * @param file the file, relative to the project root (where synth runs), e.g. `dist/ecr-import/app.tar.gz`
 */
export function buildOutputAsset(scope: Construct, id: string, file: string, options: BuildOutputAssetOptions): s3_assets.Asset {
  if (process.env.CRE_PLAN_SYNTH === '1' || process.env.JEST_WORKER_ID !== undefined) {
    return new s3_assets.Asset(scope, id, { path: placeholder() });
  }
  if (!fs.existsSync(file)) {
    throw new Error(`${file} isn't built: run npx projen ${options.builtBy} (npx projen build runs it).`);
  }
  return new s3_assets.Asset(scope, id, { path: file });
}

/** One fixed file in the temp directory: the same content (and so the same hash) every time. */
function placeholder(): string {
  const file = path.join(os.tmpdir(), 'cre-build-output-placeholder.txt');
  const body = 'placeholder for a file the build makes (buildOutputAsset)\n';
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf-8') !== body) {
    // Written aside and renamed: parallel jest workers never hash a half-written file.
    const tmp = `${file}.${process.pid}`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, file);
  }
  return file;
}
