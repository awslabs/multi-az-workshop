import { SampleFile } from 'projen';
import { createFailureScenarioChecks } from './components/tooling-tasks';
import { createContentspec } from './components/workshop-studio';
import type { WorkshopStudioOptions } from './components/workshop-studio';
import { CreDemoTemplateApp, githubPreBuildSteps } from './cre-demo-template-app';
import type { CreDemoTemplateAppOptions } from './cre-demo-template-app';
import { FAILURE_SCENARIO_LAYOUT, STANDARD_LAYOUT } from './layout';
import { CreModule } from './modules';
import { CRE_SCRIPTS } from './paths';
import { createGithubPublishWorkflow, createGitlabPublishJob } from './workflows/publish-workflow';

/**
 * A demo of a product, solution or pattern: a reference for what good looks like, built fast on
 * the vetted constructs and the provided CI/CD. Layout `src/{cdk,app}`.
 */
export class CreResilienceDemo extends CreDemoTemplateApp {
  constructor(options: CreDemoTemplateAppOptions) {
    // A resilience demo's dashboards are required.
    super(options, STANDARD_LAYOUT, 'resilience-demo.md', [], [CreModule.OBSERVABILITY]);
  }
}

/**
 * A system with an intentional failure, used to benchmark a resilience agent. The agent reviews
 * only `src/clean`; `src/deploy` overlays the failure injection, tooling and observability.
 */
export type CreFailureScenarioOptions = CreDemoTemplateAppOptions & {
  /**
   * The scenario's own give-away terms for `test:clean-purity`, on top of the generic list: the
   * source system's names, internal class names, incident ids, commit SHAs, years. Literal text,
   * case-insensitive.
   */
  readonly forbiddenTerms?: string[];
  /**
   * Ordinary words in `src/clean` that a generic `test:clean-purity` pattern mistakes for a tell
   * (a real `incident` table, a `benchmark` module): `'<path or glob> <pattern>'`, the pattern exactly
   * as `clean-purity-scan.py` lists it, e.g. `'src/clean/app/perf.py \\bbenchmark'`. Kept here,
   * outside `src/clean`, so the reviewer never sees it.
   * @default []
   */
  readonly cleanPurityAllow?: string[];
  /** The answer key (JSON Lines). @default `ground-truth/<name>.jsonl` */
  readonly groundTruthFile?: string;
};

export class CreFailureScenario extends CreDemoTemplateApp {
  public readonly groundTruthFile: string;

  constructor(options: CreFailureScenarioOptions) {
    super(options, FAILURE_SCENARIO_LAYOUT, 'failure-scenario.md');
    this.groundTruthFile = options.groundTruthFile ?? `ground-truth/${options.name}.jsonl`;
    createFailureScenarioChecks(this, {
      forbiddenTerms: options.forbiddenTerms ?? [],
      cleanPurityAllow: options.cleanPurityAllow ?? [],
      groundTruthFile: this.groundTruthFile,
    });
  }
}

/**
 * A recreation of a customer's environment from transcripts, notes or diagrams: a sandbox to
 * experiment in. The deployed environment is the deliverable. Layout `src/{cdk,app}`.
 */
export class CreCustomerSandbox extends CreDemoTemplateApp {
  constructor(options: CreDemoTemplateAppOptions) {
    super(options, STANDARD_LAYOUT, 'customer-sandbox.md');
  }
}

/** The secret (CI) or environment variable (laptop) holding Workshop Studio's build tool's location. */
export const BUILD_TOOL_LOCATION = 'BUILD_TOOL_LOCATION';
/** The build tool's platforms: a secret each, BUILD_TOOL_LOCATION_<PLATFORM> (cresetup/workshop_studio.py; a test keeps them equal). */
export const BUILD_TOOL_PLATFORMS = ['LINUX', 'LINUX_ARM', 'OSX', 'OSX_ARM', 'WINDOWS', 'WINDOWS_ARM'];
/** Those secrets' names; `location` takes the one for the runner it is on. */
const BUILD_TOOL_SECRETS = BUILD_TOOL_PLATFORMS.map((p) => `${BUILD_TOOL_LOCATION}_${p}`);
const WORKSHOP_PY = `${CRE_SCRIPTS}/build/workshop.py`;

const WORKSHOP_START_PAGE = `---
title: "Introduction"
weight: 0
---

What participants build, learn and need before they start. Each page is a folder under content/
with an index.en.md; \`weight\` orders the pages (cre-workshop-content.md).
`;

// The participant can read what the workshop deployed, and nothing more until the author adds it.
const WORKSHOP_START_POLICY = {
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow',
    Action: ['cloudformation:Describe*', 'cloudformation:List*', 'cloudformation:Get*'],
    Resource: '*',
  }],
};

export type CreWorkshopStudioOptions = CreDemoTemplateAppOptions & {
  /** The workshop's Workshop Studio settings: regions, participant role, links (contentspec.yaml). */
  readonly workshopStudio?: WorkshopStudioOptions;
};

/**
 * A workshop for AWS Workshop Studio: the CDK app is the infrastructure Workshop Studio deploys into
 * each team's account (in the one region an event picks), and `content/` is the guide participants
 * follow. contentspec.yaml is generated from `workshopStudio` and the stacks; our own pipeline only
 * test-deploys into our account. Layout `src/{cdk,app}`, `content/`, `static/`.
 */
export class CreWorkshopStudio extends CreDemoTemplateApp {
  constructor(options: CreWorkshopStudioOptions) {
    if (options.containerImages) {
      throw new Error('CreWorkshopStudio: no containerImages: a team account has no ECR repository of ours. Ship an image (or a Helm chart) as an S3 asset with CreEcrImport (CreModule.ECR_IMPORT) instead.');
    }
    // The build tool's location, one secret per platform: the PR build and the deploy's build read it.
    super(options, STANDARD_LAYOUT, 'workshop-studio.md', ['workshop-content.md'], [], BUILD_TOOL_SECRETS);
    // The build stages each top-level template into static/ (built, never committed), and checks the
    // whole workshop with Workshop Studio's own build before anything is zipped or deployed.
    // The templates: every top-level stack.
    const ids = this.plannedStacks.map((s) => s.id);
    for (const id of ids) this.gitignore.exclude(`/static/${id}.json`);
    const stage = this.addTask('workshop:stage', {
      description: 'Copy each top-level template the build staged to static/<stack>.json (contentspec.yaml points there)',
      exec: `python3 ${CRE_SCRIPTS}/build/workshop.py stage ${ids.join(' ')}`,
      condition: ids.length ? undefined : 'false',
    });
    // Two steps, one way in: `location` finds the build tool's location for the machine's platform, from
    // the CI secret for it or (--local, any machine not in CI) the template's laptop-only files; the next
    // step takes it as $BUILD_TOOL_LOCATION. Only the source differs, never the code that uses it.
    const tool = `BUILD_TOOL_LOCATION="$(python3 ${WORKSHOP_PY} location $([ -n "$CI" ] || echo --local))"`;
    this.addTask('workshop:tool-location', {
      description: "Print the build tool's location for this machine's platform: the CI secret for it (BUILD_TOOL_LOCATION_<PLATFORM>), "
        + "or with --local the template's laptop-only files",
      exec: `python3 ${WORKSHOP_PY} location "$@"`,
      receiveArgs: true,
    });
    const check = this.addTask('check:workshop', {
      description: "Workshop Studio's own build (contentspec.yaml, pages, templates) and the template checks; no AWS",
      exec: `${tool} python3 ${WORKSHOP_PY} check`,
    });
    const packageAssets = this.tasks.tryFind('package:assets')!;
    packageAssets.spawn(stage);
    packageAssets.spawn(check);
    this.addTask('preview', {
      description: 'Serve the guide at http://localhost:8080 as Workshop Studio renders it (--port <n> for another)',
      exec: `${tool} python3 ${WORKSHOP_PY} preview "$@"`,
      receiveArgs: true,
    });
    // The publish: build this commit, then publish.py with its inputs from the CI job's secrets, or with
    // --local from the laptop's Midway session (the same publish, only the source differs).
    const publish = this.addTask('publish', {
      description: "Build, then publish this commit (main's) to Workshop Studio: the S3 assets, then the guide to the workshop's "
        + 'repository. --local: the credentials from your Midway session; else (CI) from the pasted secrets',
    });
    publish.spawn(this.tasks.tryFind('build')!);
    publish.exec(`python3 ${CRE_SCRIPTS}/build/publish.py "$@"`, { receiveArgs: true });
    // The upload alone, for CI: its own step after the build, the only step that gets the
    // workshop's credentials (the CI's inputs: no switches).
    this.addTask('publish:upload', {
      description: 'CI: publish what the build made, with the inputs from the job\'s secrets (npx projen publish builds first)',
      exec: `python3 ${CRE_SCRIPTS}/build/publish.py`,
    });
    if (this.github) createGithubPublishWorkflow(this.github, BUILD_TOOL_SECRETS, this.deployApproval, githubPreBuildSteps(options));
    else createGitlabPublishJob(this, options.buildSetup?.gitlab ?? []);
    // Workshop Studio's build refuses a workshop without content/, or without the participant policy
    // contentspec.yaml names: start both (written only when missing, then the author's).
    new SampleFile(this, 'content/index.en.md', { contents: WORKSHOP_START_PAGE });
    const workshopStudio = options.workshopStudio ?? {};
    if (!workshopStudio.participantPolicies) {
      new SampleFile(this, 'static/iam_policy.json', { contents: JSON.stringify(WORKSHOP_START_POLICY, null, 2) + '\n' });
    }
    try {
      createContentspec(this, workshopStudio, this.plannedStacks);
    } catch (e) {
      // Like a plan error: one line, not a stack trace.
      if (process.env.JEST_WORKER_ID) throw e;
      console.error(`cre: npx projen FAILED: ${(e as Error).message}`);
      process.exit(1);
    }
  }
}
