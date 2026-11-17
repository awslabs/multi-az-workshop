import type { Task } from 'projen';
import { CURL_RETRY_FLAGS } from '../workflows/container-tools';

/** A step that runs curl as a command (not `cfs-curl.py` or `cfs:curl`). */
const RUNS_CURL = /(^|[\s;&|({])curl\s/;

/**
 * The task steps that run curl without the retries of `CURL_RETRY` (or `curlRetry(seconds)`). CI downloads on every run (only
 * node_modules and the yarn cache are kept), so one 504 from GitHub releases fails the build: it
 * failed a demo's weekly upgrade through a bare `curl -fsSL` in its .projenrc.ts.
 *
 * Covers the steps' own `exec`, not curls inside a script a step runs.
 */
export function unretriedDownloads(tasks: readonly Task[]): string[] {
  const found: string[] = [];
  for (const task of tasks) {
    for (const step of task.steps) {
      if (step.exec && RUNS_CURL.test(step.exec) && !step.exec.includes(`${CURL_RETRY_FLAGS} --max-time `)) found.push(task.name);
    }
  }
  return [...new Set(found)];
}

/** Refuse the synth when a task step downloads with curl without retries. */
export function refuseUnretriedDownloads(tasks: readonly Task[]): void {
  const names = unretriedDownloads(tasks);
  if (names.length === 0) return;
  throw new Error(
    `cre: task ${names.map((n) => `'${n}'`).join(', ')} runs curl without retries, so one 504 fails the build. ` +
    'Add CURL_RETRY to the curl (import { CURL_RETRY } from \'./projenrc/cre/src\'): `curl -fsSL ${CURL_RETRY} ...`, or `curlRetry(1800)` for a large file.',
  );
}
