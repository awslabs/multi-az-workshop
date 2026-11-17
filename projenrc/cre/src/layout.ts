/**
 * Where a project type keeps its source. Everything lives under `src/`; `cdk/` holds all CDK
 * (stacks and the project's own constructs) and `app/` holds all application logic (code,
 * Dockerfiles, container contexts, assets). The shared construct library is not source: it is
 * installed at `cre-constructs/` and imported as `@cre/constructs`.
 */
export interface ProjectLayout {
  /** CDK app entrypoint, relative to `src/`. */
  readonly appEntrypoint: string;
  /** CDK source dirs, relative to the repo root. Linted with the dev (relaxed) rules. */
  readonly cdkDirs: string[];
  /** Application source dirs, relative to the repo root. */
  readonly appDirs: string[];
}

/** CreResilienceDemo and CreCustomerSandbox: `src/cdk` + `src/app`. */
export const STANDARD_LAYOUT: ProjectLayout = {
  appEntrypoint: 'cdk/app.ts',
  cdkDirs: ['src/cdk'],
  appDirs: ['src/app'],
};

/**
 * CreFailureScenario: the reviewable system in `src/clean`, the failure overlay in `src/deploy`,
 * each split into `cdk/` and `app/`. The entrypoint is the overlay, which composes the clean
 * stacks with the failure tooling.
 */
export const FAILURE_SCENARIO_LAYOUT: ProjectLayout = {
  appEntrypoint: 'deploy/cdk/app.ts',
  cdkDirs: ['src/clean/cdk', 'src/deploy/cdk'],
  appDirs: ['src/clean/app', 'src/deploy/app'],
};
