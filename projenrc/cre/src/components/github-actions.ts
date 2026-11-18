import * as fs from 'fs';
import * as path from 'path';
import type { JobStep } from 'projen/lib/github/workflows-model';
import { VERSIONS_FILE } from './build-tasks';

/**
 * A project's own workflow steps name an action without a version (`uses: 'actions/setup-dotnet'`);
 * its version lives in build/versions.json as a `github-action` entry (`repo`, `version` the release
 * tag, `sha` the commit it points to), which the weekly upgrade moves. The step is written pinned
 * to that commit, so a tag moved later can't change what runs. A step that names its own `@ref` is
 * left as it is.
 */
export function pinActions(steps: readonly JobStep[], outdir: string): JobStep[] {
  const unpinned = steps.filter((s) => s.uses && !s.uses.includes('@'));
  if (!unpinned.length) return [...steps];
  const file = path.join(outdir, VERSIONS_FILE);
  let doc: Record<string, { kind?: string; repo?: string; version?: string; sha?: string }> = {};
  try { doc = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { /* none yet: every unpinned step is refused below */ }
  const byRepo = new Map(Object.values(doc).filter((e) => e?.kind === 'github-action').map((e) => [e.repo, e]));
  return steps.map((s) => {
    if (!s.uses || s.uses.includes('@')) return s;
    const e = byRepo.get(s.uses);
    if (!e?.sha) {
      throw new Error(`cre: the workflow step '${s.name ?? s.uses}' uses ${s.uses} with no version: add it to ${VERSIONS_FILE} `
        + `({ "kind": "github-action", "repo": "${s.uses}", "version": "<release tag>", "sha": "", "update": "minor" }), `
        + 'then npx projen versions:update fills in its commit.');
    }
    return { ...s, uses: `${s.uses}@${e.sha}` };
  });
}
