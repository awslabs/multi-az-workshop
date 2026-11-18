#!/usr/bin/env node
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * `npx projen build:assets`: every file the workshop's stack and guide take from the build, after
 * pre-compile emptied assets/ and before the synth that takes the images and charts as CDK assets.
 *
 *  - assets/ (fetched by name under AssetsBucketPrefix): kubectl, docker compose, the Istio
 *    destination rules, and the CodeDeploy bundles of the app and the failing app;
 *  - dist/ecr-import/ (CDK assets CreEcrImport loads into ECR): the Istio and AWS Load Balancer
 *    Controller charts and images, the app's image and the CloudWatch agent's.
 *
 * Versions come from build/versions.json, names from lib/asset-files.ts (the constructs read the
 * same). Every command is an argument list (no shell); every download is checked against the
 * checksum its publisher states (kubectl's and docker compose's .sha256, a chart's digest in its
 * repository's index.yaml); every image is pulled for linux/arm64, the architecture the cluster
 * and the fleet run. Any failure stops the build.
 */

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { gzipSync } from 'zlib';
import { CreVersions } from '@cre/constructs';
import {
  APP_LOCAL_IMAGE, ASSETS_DIR, assetFiles, CLOUDWATCH_AGENT_LOCAL_IMAGE, ECR_IMPORT_DIR, ecrImportFiles, ISTIO_CHARTS, ISTIO_IMAGES,
  LB_CONTROLLER_CHART, lbControllerImageTag,
} from './lib/asset-files';

const PLATFORM = 'linux/arm64';
/** The app's .NET runtime: Alpine (musl) on arm64. */
const DOTNET_RUNTIME = 'linux-musl-arm64';
const APP_PROJECT = 'src/app/multi-az-workshop-application.csproj';
const PUBLISH_DIR = 'src/app/output';
/** The retries every download in the build has (the CRE CURL_RETRY), with a per-attempt cap. */
const curlRetry = (maxTime: number) => ['--retry', '5', '--retry-all-errors', '--retry-delay', '5', '--connect-timeout', '10', '--max-time', String(maxTime)];
/** kubectl and docker compose are 50-60 MB: 300 s fails them below about 200 KB/s. */
const LARGE = 1800;

const versions = CreVersions.fromFile(path.resolve('build', 'versions.json'));

function log(msg: string): void {
  console.log(`build:assets: ${msg}`);
}

function run(cmd: string, args: string[], opts: { cwd?: string } = {}): void {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function capture(cmd: string, args: string[]): Buffer {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 4 * 1024 ** 3 });
}

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fetchText(url: string): string {
  return capture('curl', ['--fail', '--silent', '--show-error', '--location', ...curlRetry(300), url]).toString('utf-8');
}

/** Downloads `url` to `dest`, then checks it against `expected` (sha256 hex), removing it when it differs. */
function download(url: string, dest: string, expected: string, maxTime = 300): void {
  log(`download ${url}`);
  run('curl', ['--fail', '--silent', '--show-error', '--location', ...curlRetry(maxTime), url, '--output', dest]);
  const got = sha256(dest);
  if (got !== expected) {
    fs.rmSync(dest);
    throw new Error(`${url}: sha256 ${got}, but its publisher states ${expected}`);
  }
}

/** The sha256 a `<file>.sha256` beside the download states (`<hex>` or `<hex> *<name>`). */
function publishedSha256(url: string): string {
  const m = /^([0-9a-f]{64})\b/.exec(fetchText(`${url}.sha256`).trim());
  if (!m) throw new Error(`${url}.sha256 holds no sha256`);
  return m[1];
}

/**
 * The digest a chart repository's index.yaml states for `file`. The index is helm's own output: one
 * `  - ` item per chart version, each with its `digest:` and its `urls:`.
 */
export function chartDigest(index: string, repo: string, file: string): string {
  // A url is a list line naming the file, relative or absolute.
  const namesFile = (line: string) => line === `- ${file}` || (line.startsWith('- ') && line.endsWith(`/${file}`));
  const items = index.split(/\n {2}- /).filter((item) => item.split('\n').map((l) => l.trim()).some(namesFile));
  const digests = items.map((item) => /^\s*digest: "?([0-9a-f]{64})"?\s*$/m.exec(item)?.[1]).filter((d): d is string => !!d);
  if (digests.length !== 1) throw new Error(`${repo}/index.yaml: ${digests.length} digests for ${file}, expected 1`);
  return digests[0];
}

function charts(repo: string, files: string[]): void {
  const index = fetchText(`${repo}/index.yaml`);
  for (const file of files) download(`${repo}/${file}`, path.join(ECR_IMPORT_DIR, file), chartDigest(index, repo, file));
}

/** Pulls `ref` for linux/arm64, with backoff and jitter (Docker Hub's rate limit). */
function pull(ref: string, attempts = 4): void {
  for (let attempt = 1; ; attempt++) {
    try {
      run('docker', ['pull', '--platform', PLATFORM, ref]);
      return;
    } catch {
      if (attempt === attempts) throw new Error(`docker pull ${ref} failed ${attempts} times`);
      const delay = 2 ** attempt * 10 + Math.floor(Math.random() * 2 ** attempt * 5);
      log(`pull of ${ref} failed (rate limit or network): again in ${delay}s (${attempt}/${attempts})`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay * 1000);
    }
  }
}

/** `docker save` of `ref`, gzipped with no timestamp (the same image, the same file, the same asset hash). */
function save(ref: string, dest: string): void {
  log(`save ${ref} -> ${dest}`);
  fs.writeFileSync(dest, gzipSync(capture('docker', ['save', ref])));
}

/** The app published for Alpine on arm64 (`fail`: with FAIL defined, the failing build), as an image saved to `dest`. */
function appImage(fail: boolean, dest: string): void {
  fs.rmSync(PUBLISH_DIR, { recursive: true, force: true });
  run('dotnet', ['publish', APP_PROJECT, '--configuration', 'Release', '--runtime', DOTNET_RUNTIME, '--self-contained',
    '--output', path.join(PUBLISH_DIR, 'src'), '-p:PublishReadyToRun=true', '-p:PublishReadyToRunShowWarnings=true',
    ...(fail ? ['-p:DefineConstants=FAIL'] : [])]);
  const alpine = versions.entry('ALPINE', 'container-image');
  const base = `${alpine.image}:${alpine.version}`;
  // Through the retrying pull first: docker build then reads the base from the local store.
  pull(base);
  run('docker', ['build', '--platform', PLATFORM, '--tag', APP_LOCAL_IMAGE, '--build-arg', `BASE=${base}`, '--build-arg', 'SRC=src',
    '--file', 'build/dockerfile', PUBLISH_DIR]);
  save(APP_LOCAL_IMAGE, dest);
  fs.rmSync(PUBLISH_DIR, { recursive: true, force: true });
}

/** A CodeDeploy bundle: the app's and the agent's images at its root, src/app/docker, and appspec.yml at its root. */
function bundle(image: string, name: string): void {
  const zip = path.resolve(ASSETS_DIR, name);
  const agent = path.join(ECR_IMPORT_DIR, ecrImportFiles.cloudwatchAgentImage);
  const staged = path.join('dist', 'bundle');
  fs.rmSync(staged, { recursive: true, force: true });
  fs.mkdirSync(staged, { recursive: true });
  fs.copyFileSync(image, path.join(staged, ecrImportFiles.appImage));
  fs.copyFileSync(agent, path.join(staged, ecrImportFiles.cloudwatchAgentImage));
  fs.cpSync('src/app/docker', path.join(staged, 'docker'), { recursive: true });
  fs.copyFileSync('src/app/docker/appspec.yml', path.join(staged, 'appspec.yml'));
  run('zip', ['-q', '-r', zip, '.'], { cwd: staged });
  fs.rmSync(staged, { recursive: true, force: true });
}

function main(): void {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  fs.rmSync(ECR_IMPORT_DIR, { recursive: true, force: true });
  fs.mkdirSync(ECR_IMPORT_DIR, { recursive: true });

  // The Istio destination rules the guide applies (one per region it can run in).
  for (const f of fs.readdirSync('src/cdk/configs').filter((n) => /^destination-rule.*\.yaml$/.test(n))) {
    fs.copyFileSync(path.join('src/cdk/configs', f), path.join(ASSETS_DIR, f));
  }

  const kubectl = `https://dl.k8s.io/release/v${versions.version('KUBECTL', 'kubectl')}/bin/linux/arm64/kubectl`;
  download(kubectl, path.join(ASSETS_DIR, assetFiles.kubectl), publishedSha256(kubectl), LARGE);
  const compose = versions.entry('DOCKER_COMPOSE', 'github-release');
  const composeUrl = `https://github.com/${compose.repo}/releases/download/v${compose.version}/docker-compose-linux-aarch64`;
  download(composeUrl, path.join(ASSETS_DIR, assetFiles.dockerCompose), publishedSha256(composeUrl), LARGE);

  const istio = versions.entry('ISTIO', 'helm-chart');
  charts(istio.repo!, ISTIO_CHARTS.map((c) => ecrImportFiles.chart(c, istio.version)));
  const lb = versions.entry('AWS_LOAD_BALANCER_CONTROLLER', 'helm-chart');
  charts(lb.repo!, [ecrImportFiles.chart(LB_CONTROLLER_CHART, lb.version)]);

  // The distroless variant: no OS package set, so none of the base image's CVEs (the charts' global.variant selects it).
  for (const image of ISTIO_IMAGES) {
    const ref = `docker.io/istio/${image}:${istio.version}-distroless`;
    pull(ref);
    save(ref, path.join(ECR_IMPORT_DIR, ecrImportFiles.istioImage(image)));
  }
  const lbRef = `public.ecr.aws/eks/aws-load-balancer-controller:${lbControllerImageTag(lb.version)}`;
  pull(lbRef);
  save(lbRef, path.join(ECR_IMPORT_DIR, ecrImportFiles.lbControllerImage));
  // The pinned agent, saved under the local tag docker-compose.yml runs.
  const agent = versions.entry('CLOUDWATCH_AGENT', 'container-image');
  pull(`${agent.image}:${agent.version}`);
  run('docker', ['tag', `${agent.image}:${agent.version}`, CLOUDWATCH_AGENT_LOCAL_IMAGE]);
  save(CLOUDWATCH_AGENT_LOCAL_IMAGE, path.join(ECR_IMPORT_DIR, ecrImportFiles.cloudwatchAgentImage));

  // The app: its image (EKS, and the fleet's bundle), then the failing build's bundle.
  const appTarball = path.join(ECR_IMPORT_DIR, ecrImportFiles.appImage);
  appImage(false, appTarball);
  bundle(appTarball, assetFiles.appBundle);
  const failing = path.join('dist', 'failing-app.tar.gz');
  appImage(true, failing);
  bundle(failing, assetFiles.failingAppBundle);
  fs.rmSync(failing);
  log('done');
}

// Run as the build's script; a test imports it for chartDigest.
if (require.main === module) main();
