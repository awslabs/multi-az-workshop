import type { awscdk } from 'projen';
import { CRE_SCRIPTS } from '../paths';

/**
 * Provider-AGNOSTIC build lifecycle for the green CRE demo skeleton.
 *
 * Part of the cre-projen package (vendored into each demo at projenrc/cre/), called by
 * CreDemoTemplateApp for both providers. CI in both families only ever invokes
 * the projen tasks registered here (`npx projen <task>`) — this is the PROJEN_PATTERN
 * "CI ↔ task parity" principle that keeps the GitHub/GitLab seam narrow.
 *
 * The lifecycle:
 *
 *   preCompileTask   → wipe assets/ + cdk.out/ so downstream phases start clean
 *   compileTask      → tsc (projen-native, unchanged)
 *   postCompileTask  → `synth:silent` (cdk synth), check:stack-wiring, check:stack-plan, then
 *                      with containerImages build:container-plan + build:docker
 *   testTask         → jest + eslint (projen-native, unchanged)
 *   packageTask      → stage CFN assets (package:assets) → zip into dist/content.zip
 *
 * Result: one `yarn build` (or `npx projen build`) produces `dist/content.zip`
 * carrying the CFN template + staged file assets the deploy mechanism consumes.
 *
 * The container tasks exist only with `containerImages`: without a DockerImageAsset in the app
 * there is nothing for them to build.
 */
/**
 * Options for {@link createBuildTasks}.
 *
 * `containerImages` is the single toggle gating the container-build
 * lifecycle. When false (the green skeleton default), NO docker tasks are registered
 * and NO docker steps attach to postCompile — the skeleton emits zero container work
 * and stays green with zero edits (NFR1). The provider workflow factories receive the
 * SAME flag so CI jobs and lifecycle tasks light up together — never one without the
 * other (the failure mode where a job is emitted with no asset, or vice-versa).
 *
 * Both providers build images the same way: `build:container-plan` + `build:docker` run in
 * postCompile and write `assets/containers/<hash>.tar.gz` (`docker build` on GitHub runners and
 * laptops; the GitLab build:docker job runs kaniko-build.sh instead, as its runners allow no Docker
 * daemon), and
 * `deploy:docker` pushes them with crane. See workflows/container-tools.ts.
 */
export interface BuildTaskOptions {
  readonly containerImages?: boolean;
  /**
   * The deployed name of every stack (from the app, via cre-stacks.json). Each one's template and
   * assets go into dist/content.zip; taken from the same plan the deploy uses, so the two can't disagree.
   */
  readonly stackIds: string[];
  /** Add the `ci:build:*` entry points GitLab's build jobs call. GitHub's workflows run `projen build`. */
  readonly ciEntryPoints?: boolean;
}

/** Wipe what synth and packaging rebuild (cdk synth doesn't prune stale files of removed stacks). */
const CLEAN = 'rm -rf assets cdk.out && mkdir -p assets dist';

/**
 * The checks straight after synth, in order: one list for post-compile (local `npx projen build`)
 * and ci:build:cdk, so a check added to one is never missing from the other (review 10b F9).
 */
const POST_SYNTH_CHECKS = ['check:stack-wiring', 'check:stack-plan', 'versions:check'] as const;

/** The version file versions.py reads and the weekly upgrade rewrites (steering cre-versions.md). */
export const VERSIONS_FILE = 'build/versions.json';

export function createBuildTasks(
  project: awscdk.AwsCdkTypeScriptApp,
  opts: BuildTaskOptions,
): void {
  // --- granular tasks (also wired into the lifecycle below) ----------------

  // For each top-level stack, scripts/build/package.py:
  //   1. Rewrites nested templates that reference ${AssetsBucket*} to accept
  //      them as parameters, piping the parent's params through.
  //   2. Copies every file asset into assets/<hash>.<ext> (zipping directories).
  //   3. Copies the top-level template to assets/<stack_name>.json so the deploy
  //      task can target it by name via --template-url.
  //
  // Does NOT wipe assets/ — preCompile handles that once per build so postCompile
  // phases can share the folder.
  const packageAssets = project.addTask('package:assets', {
    description: "Stage every stack's assets into assets/ and rewrite nested templates",
    steps: opts.stackIds.map((id) => ({ exec: `python3 ${CRE_SCRIPTS}/build/package.py ${id} .` })),
  });

  const packageContent = project.addTask('package:content', {
    description: 'Build dist/content.zip — the artifact the deploy stage consumes',
    steps: [
      { exec: 'rm -f dist/content.zip' },
      // An app with no stacks stages nothing, and zip refuses an empty tree ("Nothing to do!"):
      // write an empty archive, so the artifact the deploy stage consumes always exists.
      {
        // bash, not projen's built-in shell, which has no `if`.
        exec: 'mkdir -p dist assets && cd assets && if [ -n "$(ls -A)" ]; then zip -r ../dist/content.zip .; ' +
          'else python3 -c "import zipfile; zipfile.ZipFile(\'../dist/content.zip\', \'w\').close()"; fi',
        shell: ['bash', '-c'],
      },
    ],
  });

  // projen's synth:silent is `cdk synth -q`, which exits 1 for an app with no stacks. A fresh
  // scaffold has none on purpose, so synth through synth.py, which accepts exactly that case.
  project.tasks.tryFind('synth:silent')?.reset(`python3 ${CRE_SCRIPTS}/build/synth.py`);

  if (opts.ciEntryPoints) {
    // CI build entry point — the composite task GitLab's `build:cdk` job invokes (GitHub's
    // workflows run `projen build`, so a GitHub project doesn't get it). Named so a
    // workflow `needs:`/job graph can reference it directly. Runs the non-docker
    // half of projen's lifecycle so the build job needs only a plain node image:
    // wipe assets/ + cdk.out/, compile, synth, lint + unit test (projen's `test`
    // task spawns both jest and eslint), then stage CFN assets into assets/.
    project.addTask('ci:build:cdk', {
      description: 'CI: CDK synthesis + tests + asset staging (provider build-job entry point)',
      steps: [
        // Wipe assets/ + cdk.out/ because `cdk synth` doesn't prune stale
        // *.assets.json files from renamed/removed stacks, and package:assets
        // expects a clean assets/ tree. dist/ is NOT wiped — it carries state
        // between lifecycle phases (dist/<stack>.env dotenvs, dist/<stack>.params.json).
        // `mkdir -p dist` is defensive.
        { exec: CLEAN },
        // Before anything regenerates them: the committed pipeline must be the current one (#15).
        { spawn: 'check:generated' },
        { spawn: 'compile' },
        { spawn: 'synth:silent' },
        ...POST_SYNTH_CHECKS.map((spawn) => ({ spawn })),
        { spawn: 'test' },
        { spawn: 'package:assets' },
      ],
    });

    // CI package entry point — zips the staged assets/ tree into dist/content.zip.
    // Kept as a named `ci:build:*` alias (rather than the job calling
    // `yarn package:content` directly) so all build-stage CI entry points share
    // the namespace and the provider workflow's job→task mapping stays trivial.
    project.addTask('ci:build:package', {
      description: 'CI: zip assets/ into dist/content.zip (provider package-job entry point)',
      steps: [...(opts.containerImages ? [{ spawn: 'build:image-tags' }] : []), { spawn: 'package:content' }],
    });
  }

  // Stacks pass values as outputs -> parameters of the same name, never CloudFormation exports
  // (steering cre-pipelines.md). Checked on what synth wrote, so it runs straight after synth:
  // in post-compile (local `npx projen build`, before any image build) and in ci:build:cdk.
  // Not in `test`: `npx projen test` alone doesn't synth, so it would check a stale cdk.out.
  project.addTask('check:generated', {
    description: 'CI only: fail when the committed generated files (pipeline, cre-stacks.json, ...) are not what npx projen makes',
    steps: [{ exec: `python3 ${CRE_SCRIPTS}/build/check-generated.py` }],
  });

  project.addTask('check:stack-wiring', {
    description: 'Fail if any synthesized stack uses a CloudFormation export/import or crossRegionReferences (pass outputs -> parameters instead)',
    steps: [{ exec: `python3 ${CRE_SCRIPTS}/build/check-stack-wiring.py cdk.out` }],
  });

  // The app must still create exactly the stacks the committed cre-stacks.json (and the pipeline) was generated from, each
  // a CreStack with no fixed environment, declaring every parameter the deploy passes and every
  // output later stacks use: the deploy is generated from the list, so a mismatch fails here.
  project.addTask('check:stack-plan', {
    description: 'Fail if the synthesized app differs from the committed cre-stacks.json, a stack sets terminationProtection, or a container image asset would not be built or pushed to its account',
    // The project's containerImages: an image asset with nothing to build it fails here (review 10c A4).
    steps: [{ exec: `python3 ${CRE_SCRIPTS}/build/check-stack-plan.py cre-stacks.json cdk.out --container-images ${opts.containerImages ? 'on' : 'off'}` }],
  });

  // No check that setup set each variable a stack needs: a CI job can't list the project's
  // variables, and the deploy stops on an unset one before it calls CloudFormation (REQUIRED_VARS).
  // The version file: only kinds with a lookup (no network), and the weekly upgrade moves each entry
  // to the newest version its `update` allows, with the read-only versions role's credentials.
  project.addTask('versions:check', {
    description: `Check ${VERSIONS_FILE} (every entry has a lookup) and that no synthesized template takes a version from elsewhere (no network)`,
    exec: `python3 ${CRE_SCRIPTS}/build/versions.py check --file ${VERSIONS_FILE} --templates cdk.out`,
  });
  // Not part of `upgrade` (post-upgrade): the weekly upgrade runs the lookups apart from the upgraded
  // npm code, which gets no AWS credentials (GitHub: the `versions` job; GitLab: before the upgrade).
  project.addTask('versions:update', {
    description: `Move each ${VERSIONS_FILE} entry to the newest version its update allows (AWS lookups need credentials)`,
    exec: `python3 ${CRE_SCRIPTS}/build/versions.py update --file ${VERSIONS_FILE}`,
  });
  for (const name of POST_SYNTH_CHECKS) project.postCompileTask.spawn(project.tasks.tryFind(name)!);

  // --- container tasks (gated on containerImages) ---------------------------
  //
  // Registered ONLY when containerImages is true. These are the provider-agnostic
  // task layer behind both providers' container jobs:
  //   build:container-plan  reads cdk.out/*.assets.json (the one DockerImageAsset the
  //                         LoadGenerator declares) → assets/containers/manifest.json
  //                         + dist/container-plan.tsv (scripts/build/container-plan.py).
  //   build:docker          builds each image into assets/containers/<hash>.tar.gz with
  //                         `docker build` (scripts/build/build-docker.py): GitHub runners and
  //                         laptops. The GitLab build:docker job runs kaniko-build.sh instead
  //                         (no Docker daemon on those runners).
  //   ci:build:container-plan  composite alias the GitLab build:container-plan job calls.
  // postCompile ordering matters: plan THEN build (build reads the .tsv the plan wrote).
  // The container scripts ship in every demo (projenrc/cre/scripts/build/),
  // but these tasks must still never register when the flag is off (NFR1 — a
  // build:docker that runs with no Dockerfile breaks green).
  if (opts.containerImages) {
    const buildContainerPlan = project.addTask('build:container-plan', {
      description: 'Enumerate DockerImageAssets into manifest.json + container-plan.tsv',
      steps: [{ exec: `python3 ${CRE_SCRIPTS}/build/container-plan.py` }],
    });
    const buildDocker = project.addTask('build:docker', {
      description: 'Build every DockerImageAsset into assets/containers/ (docker build; GitLab CI uses kaniko)',
      steps: [{ exec: `python3 ${CRE_SCRIPTS}/build/build-docker.py` }],
    });
    // After the images are built and the templates staged (package:assets): each image's tag
    // becomes its asset hash plus a hash of its installed OS packages, in the manifest the deploy
    // pushes and in the templates, so a rebuild with new packages redeploys and one without doesn't.
    project.addTask('build:image-tags', {
      description: 'Tag every built image by its asset hash and installed OS packages (manifest.json and the staged templates)',
      steps: [{ exec: `python3 ${CRE_SCRIPTS}/build/image-tags.py` }],
    });
    if (opts.ciEntryPoints) {
      project.addTask('ci:build:container-plan', {
        description: 'CI: produce manifest.json + container-plan.tsv (container-plan job entry point)',
        steps: [{ spawn: 'build:container-plan' }],
      });
    }
    // postCompile: synth:silent (projen-native) already ran cdk synth above; now plan
    // the containers, then build them (with docker; without one, a local build warns and CI
    // builds them).
    project.postCompileTask.spawn(buildContainerPlan);
    project.postCompileTask.spawn(buildDocker);
  }

  // --- lifecycle wiring ----------------------------------------------------

  // preCompile: clean slate. Downstream phases share assets/ and cdk.out/, so
  // wipe both once here rather than at the start of every individual task.
  // Wiping cdk.out/ matters because `cdk synth` doesn't prune files from stacks
  // that have been renamed or removed. dist/ is NOT wiped (it carries cross-phase
  // state); `mkdir -p dist` just ensures it exists for package:content to write.
  project.preCompileTask.exec(CLEAN);

  // compile: type-check every file under src/ (tsconfig.json's include). projen's CDK app leaves
  // compile empty and ts-node checks only what app.ts imports, so a type error anywhere else (a
  // Lambda handler, a helper not yet wired in) passed the build (review 10b A4). No emit: the CDK
  // app runs from source.
  project.compileTask.exec('tsc --noEmit');


  // package: stage CFN assets, then zip the whole assets/ tree. Gotcha 8 —
  // reset() before re-authoring the native `package` task so we replace projen's
  // default rather than appending to it. package:assets runs here (not earlier)
  // because rewriting templates for the ${AssetsBucket*} params is a packaging
  // concern, not a compile concern.
  project.packageTask.reset();
  project.packageTask.description = 'Stage CFN assets and zip into dist/content.zip';
  project.packageTask.spawn(packageAssets);
  if (opts.containerImages) project.packageTask.spawn(project.tasks.tryFind('build:image-tags')!);
  project.packageTask.spawn(packageContent);
}
