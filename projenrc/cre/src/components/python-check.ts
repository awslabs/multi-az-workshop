import { execFileSync } from 'child_process';

/**
 * The oldest Python the CRE scripts run on: setup and every project task call `python3`. 3.12 has
 * tarfile's safe extraction (`filter="data"`) and is what the CI images ship (GitHub's ubuntu-24.04,
 * GitLab's node:<n>-alpine has newer). setup_project.py and the recipe check the same version.
 */
export const MIN_PYTHON: readonly [number, number] = [3, 12];

/**
 * The problem with this machine's `python3` (missing, or older than MIN_PYTHON), or undefined when
 * there is none. `run` gives `python3`'s "major minor" (a seam for tests).
 */
export function pythonProblem(run: () => string = () => execFileSync('python3', ['-c', 'import sys; print(*sys.version_info[:2])'],
  { encoding: 'utf-8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] })): string | undefined {
  const want = MIN_PYTHON.join('.');
  let out: string;
  try {
    out = run();
  } catch {
    return `no python3 on PATH: install Python ${want} or later (brew install python@3.13), then run npx projen again`;
  }
  const [major, minor] = out.trim().split(/\s+/).map(Number);
  if (major > MIN_PYTHON[0] || (major === MIN_PYTHON[0] && minor >= MIN_PYTHON[1])) return undefined;
  return `python3 is ${major}.${minor}; the CRE tasks need ${want} or later: install it (brew install python@3.13) `
    + 'so python3 on PATH is the new one, then run npx projen again';
}
