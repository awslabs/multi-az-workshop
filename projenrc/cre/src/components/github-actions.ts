import * as fs from 'fs';
import * as path from 'path';
import type { JobStep } from 'projen/lib/github/workflows-model';
import { VERSIONS_FILE } from './build-tasks';

/**
 * A project's own workflow steps name an action without a version (`uses: 'actions/setup-dotnet'`);
 * its version lives in build/versions.json as a `github-action` entry (`repo`, `version` the release
 * tag, `sha` the commit it points to), which the daily upgrade moves. The step is written pinned
 * to that commit, so a tag moved later can't change what runs. A step that names its own `@ref` is
 * left as it is.
 */
/** A step whose action has a release to pin: not a local action (`./…`) or a Docker image (`docker://…`), and no `@ref` yet. */
const pinnable = (s: JobStep): boolean => !!s.uses && !s.uses.includes('@') && !s.uses.startsWith('./') && !s.uses.startsWith('docker://');

/** The repository an action lives in: `owner/repo` of `owner/repo/path/to/action`. */
const actionRepo = (uses: string): string => uses.split('/').slice(0, 2).join('/');

export function pinActions(steps: readonly JobStep[], outdir: string): JobStep[] {
  const unpinned = steps.filter(pinnable);
  if (!unpinned.length) return [...steps];
  const file = path.join(outdir, VERSIONS_FILE);
  let doc: Record<string, { kind?: string; repo?: string; version?: string; sha?: string }> = {};
  try { doc = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { /* none yet: every unpinned step is refused below */ }
  const byRepo = new Map(Object.values(doc).filter((e) => e?.kind === 'github-action').map((e) => [e.repo, e]));
  return steps.map((s) => {
    if (!pinnable(s)) return s;
    const repo = actionRepo(s.uses!);
    const e = byRepo.get(repo);
    if (!e?.sha) {
      throw new Error(`cre: the workflow step '${s.name ?? s.uses}' uses ${s.uses} with no version: add it to ${VERSIONS_FILE} `
        + `({ "kind": "github-action", "repo": "${repo}", "version": "<release tag>", "sha": "", "update": "minor" }), `
        + 'then npx projen versions:update fills in its commit.');
    }
    return { ...s, uses: `${s.uses}@${e.sha}` };
  });
}
