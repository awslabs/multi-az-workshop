import * as fs from 'fs';
import * as path from 'path';
import { awscdk, javascript } from 'projen';
import { GithubCredentials } from 'projen/lib/github';
import { AppPermission, JobPermission } from 'projen/lib/github/workflows-model';
import type { JobStep } from 'projen/lib/github/workflows-model';
import { NodePackageManager, UpdateSnapshot, UpgradeDependenciesSchedule } from 'projen/lib/javascript';
import { createBuildTasks, VERSIONS_FILE } from './components/build-tasks';
import { CdkVersionEntry, cdkVersion } from './components/cdk-version';
import { createDeployTasks, DEFAULT_BINDLE_ID } from './components/deploy-tasks';
import { refuseUnretriedDownloads } from './components/download-check';
import { createGitTasks } from './components/git-tasks';
import type { GitProvider } from './components/git-tasks';
import { pinActions } from './components/github-actions';
import { pythonProblem } from './components/python-check';
import { createSkillsTasks } from './components/skills-tasks';
import { stackJobs, VERSIONS_ROLE_VARIABLE } from './components/stack-jobs';
import { cdkAppCommand, IAM_CONTROL_PLANE_REGION, planStacks, PLAN_FILE, readPlan, writePlanFile } from './components/stack-plan';
import type { CrePartition, PlannedStack } from './components/stack-plan';
import { createSteering, templateClone } from './components/steering';
import { createTemplateTasks } from './components/template-tasks';
import { createToolingTasks } from './components/tooling-tasks';
import type { ProjectLayout } from './layout';
import { LocalOnlyFiles, localOnlyIgnores } from './local-only';
import { ConstructModules, CreModule, installConstructModules, moduleSteering, resolveModules } from './modules';
import { CRE_CONSTRUCTS_DIR, CRE_CONSTRUCTS_PACKAGE, CRE_SCRIPTS } from './paths';
import { ACTIONS, NODE_MAJOR, secretsEnv } from './workflows/actions';
import { GITHUB_QEMU_STEP } from './workflows/container-tools';
import { createDeployWorkflow } from './workflows/deploy-workflow';
import { createGitlabWorkflow, DEPLOY_ENVIRONMENT } from './workflows/gitlab-workflow';

/** The projen version the package is built and tested against. Bootstrap installs exactly this. */
export const PROJEN_VERSION = '0.104.8';

/**
 * GitLab has nothing to set here: `gitlab: {}` picks the provider. Where the pipeline's own AWS
 * calls go needs no answer: each stack job runs in its stack's region, and the upload and prune
 * jobs reach every region's bucket from credentials in the partition's control-plane region.
 */
export type GitlabOptions = Record<string, never>;

export interface GithubOptions {
  /** The builder's GitHub username, trusted by projen's auto-approve and auto-queue workflows. */
  readonly username: string;
  /**
   * Other people whose PRs auto-approve and auto-queue act on, as for `username` (teammates who push
   * to this repo). Everyone else's PRs wait for a human approval. GitHub logins.
   * @default []
   */
  readonly trustedUsers?: string[];
  /**
   * The builder's GitHub App (`aws-cre-automation-<alias>`, made by `npx projen setup:github-app`)
   * that projen's workflows push, open PRs and merge with (dependency upgrades, self-mutation,
   * auto-merge): its slug, as in `https://github.com/apps/<slug>`. Its token is minted per run,
   * lasts an hour and reaches only the repositories it is installed on; its PRs are authored by
   * `<slug>[bot]`, which auto-approve trusts. The repo needs the `PROJEN_APP_ID` and
   * `PROJEN_APP_PRIVATE_KEY` secrets (setup:repo sets them). The workflow's own GITHUB_TOKEN can't
   * do this job: PRs and merges made with it start no workflows, so the build would never run on an
   * upgrade PR and a merge would never deploy.
   */
  readonly appSlug: string;
  /**
   * The repo's visibility on GitHub, which decides how PRs merge and where the deploy runs:
   *  - `private`: the build workflow merges a PR after its build passes (GitHub's free plan can't
   *    protect a private repo's main, so its auto-merge wouldn't wait), and the deploy jobs use the
   *    runner role's trust of main.
   *  - `public`: GitHub's auto-merge behind main's protection, and every deploy job runs in the
   *    `AWS` environment, whose OIDC subject the runner role trusts instead of main's.
   *  - `internal`: as public, without the environment.
   * Setup writes it; `npx projen setup:github-public` changes it with the repo.
   * @default 'private'
   */
  readonly visibility?: 'private' | 'public' | 'internal';
}

/** How long the deploy jobs' AWS credentials last on GitHub: setup's runner role allows 2 h (setup-cdk iam-stack.ts). */
export const GITHUB_ROLE_SECONDS = 7200;

/** The Conventional Commits v1.0.0 types (commit messages and PR titles). */
export const CONVENTIONAL_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'] as const;

const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/** Who opens the PRs auto-approve and auto-queue act on: the builder, the App's bot, GitHub's bots. */
export function trustedAuthors(github: GithubOptions): string[] {
  const people = [github.username, ...(github.trustedUsers ?? [])];
  for (const u of people) {
    // A typo here leaves every PR of that person waiting for an approval nobody gives (#35c).
    if (!GITHUB_LOGIN.test(u ?? '')) throw new Error(`github: '${u}' is not a GitHub login.`);
  }
  return [...new Set(people), `${github.appSlug}[bot]`, 'github-actions[bot]', 'dependabot[bot]'];
}

/**
 * The credential projen's workflows push, open PRs and merge with. The App token is limited to what
 * those jobs do: write the repository (including workflow files, which upgrades and self-mutation
 * regenerate) and pull requests.
 */
export function projenCredentials(github: GithubOptions): GithubCredentials {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(github.appSlug ?? '')) {
    throw new Error(`github.appSlug '${github.appSlug}' is not an App slug (the <slug> in https://github.com/apps/<slug>).`);
  }
  return GithubCredentials.fromApp({
    permissions: { contents: AppPermission.WRITE, pullRequests: AppPermission.WRITE, workflows: AppPermission.WRITE },
  });
}

/**
 * How a GitHub PR waits for its build before it merges:
 *  - `workflow`: the build workflow merges it (a `merge` job after a passing build). For a private
 *    repo, which a free plan can't protect, so GitHub's own auto-merge would merge at once (seen
 *    live: PR #7 merged before its build ran, and the deploy ran untested).
 *  - `auto-merge`: GitHub's auto-merge, which main's branch protection (setup: the `build` check,
 *    one approval) makes wait for the build. For a public (or internal) repo.
 * From `github.visibility` in .projenrc.ts (private when unset, the safe default: it merges only
 * after a build either way).
 */
export type GithubMergeMode = 'workflow' | 'auto-merge';

export function githubMergeMode(github: GithubOptions): GithubMergeMode {
  return (github.visibility ?? 'private') === 'private' ? 'workflow' : 'auto-merge';
}

/**
 * The plan the deployed stacks come from: main's committed cre-stacks.json (origin's default
 * branch, else HEAD's), or the file on disk outside a git checkout. Comparing with the working
 * tree's file warned about stacks that were never deployed, once, and then never again (review 10f A5).
 */
function deployedPlan(outdir: string): Array<{ id: string; kind?: string }> | undefined {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { execFileSync } = require('child_process') as typeof import('child_process');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: outdir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  const parse = (text: string) => (JSON.parse(text).stacks ?? []) as Array<{ id: string; kind?: string }>;
  let main = 'main';
  try {
    main = git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD').trim().replace(/^origin\//, '') || 'main';
  } catch { /* no origin/HEAD: main */ }
  for (const rev of [`origin/${main}`, 'HEAD']) {
    try {
      return parse(git('show', `${rev}:${PLAN_FILE}`));
    } catch { /* not there: the next one */ }
  }
  try {
    return parse(fs.readFileSync(path.join(outdir, PLAN_FILE), 'utf-8'));
  } catch {
    return undefined;
  }
}

/**
 * The stacks main's plan has and this app no longer does: once this change merges and deploys they
 * stay deployed until `npx projen teardown --orphans` (review 10c A15). Said on every run until it
 * merges. An edge that leaves is a distribution whose replacement needs onboarding (review 10f A3).
 */
export function warnLeftThePlan(outdir: string, ids: readonly string[]): string[] {
  const before = deployedPlan(outdir);
  if (!before) return [];
  const gone = before.filter((st) => !ids.includes(st.id));
  for (const st of gone) {
    console.warn(`cre: ${st.id} is in main's plan but not this one. Once this change merges and deploys it stays deployed until ` +
      'it is deleted: show the user npx projen teardown --orphans --dry-run, then run it without --dry-run once they agree (it deletes ' +
      'when run). A rename creates the new stack beside it: a resource with a fixed name the old one holds collides on the new ' +
      'stack\'s deploy, so derive names from the stack id. (A renamed CrePeeringStack is safe: the new stack adopts the live ' +
      'peering, and the old stack\'s delete leaves it alone.)' +
      (st.kind === 'edge' ? ' It is a CloudFront Signer edge: its replacement is a new distribution with a new domain, which answers 403 ' +
        'until npx projen cfs:onboard runs for it after its first deploy; offboard the old one (npx projen cfs:onboard --offboard ' +
        '--domain <old domain>) before tearing it down.' : ''));
  }
  return gone.map((st) => st.id);
}

/**
 * projen's auto-approve runs on every `opened` and `labeled` event while the PR has the label: a PR
 * opened with both labels fired three runs and three approvals (three review emails to its author).
 * Approve on `opened` (labels already there), on adding the `auto-approve` label itself, and on a
 * new commit (synchronize); never on adding another label. The git tasks open the PR without
 * labels and then add both, so it is approved exactly once.
 */
export function approveOncePerLabel(project: awscdk.AwsCdkTypeScriptApp, github: GithubOptions): void {
  const file = project.github?.tryFindWorkflow('auto-approve')?.file;
  if (!file) return;
  const trusted = trustedAuthors(github);
  const authors = trusted.map((u) => `github.event.pull_request.user.login == '${u}'`).join(' || ');
  // The event's sender too: on a new commit (synchronize) that is who pushed it, so a commit someone
  // untrusted pushes onto a trusted author's PR is never approved for them (review 10b D8).
  const senders = trusted.map((u) => `github.event.sender.login == '${u}'`).join(' || ');
  file.addOverride('jobs.approve.if', "contains(github.event.pull_request.labels.*.name, 'auto-approve') && " +
    "(github.event.action != 'labeled' || github.event.label.name == 'auto-approve') && " + `(${authors}) && (${senders})`);
}

/**
 * The line that says why a synth failed, out of its stderr: a TypeScript error, a construct's
 * `Error:` or a validation failure. It was 5-15 lines above the end, under a stack trace, so `tail`
 * showed only the trace (review 10f A6). '' when there is none.
 */
export function firstSynthError(stderr: string): string {
  const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean);
  // A validation failure's own line is `[construct/path] message`, under a header that says only
  // "Validation failed"; then a TypeScript error; then any `SomethingError: message`.
  const hit = lines.find((l) => /^\[[^\]]+\] \S/.test(l)) ??
    lines.find((l) => /error TS\d+:/.test(l)) ??
    lines.find((l) => /^\w*Error:\s/.test(l));
  return (hit ?? '').slice(0, 400);
}

/** The branch projen's `upgrade-main` workflow opens its PR from, and the identity it commits as. */
export const GITHUB_UPGRADE_BRANCH = 'github-actions/upgrade-main';
export const GITHUB_UPGRADE_BOT = '41898282+github-actions[bot]@users.noreply.github.com';

/**
 * projen's GitHub upgrade (peter-evans/create-pull-request) rebuilds its branch from main and
 * force-pushes it every week, so a person's fix on the upgrade PR (a web edit, a plain push) was
 * replaced (review 10f B4; 10c B15 fixed GitLab's half). A step before the PR step reads the branch:
 * while any commit on it has an author or committer that isn't the bot, the PR step is skipped, with
 * a warning, until that PR merges or the branch is deleted. An unreadable branch stops the job.
 */
export function guardGithubUpgradeBranch(project: awscdk.AwsCdkTypeScriptApp): void {
  const wf = project.upgradeWorkflow?.workflows[0];
  if (!wf) return;
  const job = wf.getJob('pr') as { steps?: Array<Record<string, unknown>> };
  const steps = [...(job.steps ?? [])];
  const at = steps.findIndex((st) => st.id === 'create-pr');
  if (at < 0) throw new Error("cre: projen's upgrade-main workflow has no create-pr step to guard.");
  const guard = {
    name: 'Skip while a person has commits on the upgrade branch',
    id: 'upgrade_guard',
    run: [
      'set -euo pipefail',
      `rc=0; git ls-remote --exit-code origin refs/heads/${GITHUB_UPGRADE_BRANCH} >/dev/null || rc=$?`,
      'if [ "$rc" = 2 ]; then echo "human=false" >>"$GITHUB_OUTPUT"; exit 0; fi',
      `if [ "$rc" != 0 ]; then echo "Could not read ${GITHUB_UPGRADE_BRANCH} from the repository." >&2; exit 1; fi`,
      // Explicit refspecs: actions/checkout leaves a single-branch, depth-1 clone, where a bare
      // `git fetch origin <branch>` makes no remote-tracking ref. Unshallow, so main..branch is exact.
      `refs="+refs/heads/main:refs/remotes/origin/main +refs/heads/${GITHUB_UPGRADE_BRANCH}:refs/remotes/origin/${GITHUB_UPGRADE_BRANCH}"`,
      'if [ "$(git rev-parse --is-shallow-repository)" = true ]; then git fetch -q --unshallow origin $refs; else git fetch -q origin $refs; fi',
      // Read first, so a failed git log stops the job instead of reading as "no person's commit".
      `who="$(git log --format='%ae%n%ce' "origin/main..origin/${GITHUB_UPGRADE_BRANCH}")"`,
      `if printf '%s\\n' "$who" | grep -v '^$' | grep -qvxF '${GITHUB_UPGRADE_BOT}'; then`,
      `  echo "::warning::${GITHUB_UPGRADE_BRANCH} has commits that aren't the upgrade workflow's; skipping so they are not overwritten. Merge its PR, or delete the branch (closing the PR leaves the branch, and this keeps skipping); then the next run upgrades again."`,
      '  echo "human=true" >>"$GITHUB_OUTPUT"',
      'else',
      '  echo "human=false" >>"$GITHUB_OUTPUT"',
      'fi',
    ].join('\n'),
  };
  steps[at] = { ...steps[at], if: "steps.upgrade_guard.outputs.human != 'true'" };
  steps.splice(at, 0, guard);
  wf.updateJob('pr', { ...(job as object), steps } as never);
}

/**
 * The daily upgrade's version lookups (versions:update), on GitHub: a job of their own, `versions`,
 * with the read-only versions role (VERSIONS_ROLE_ARN, a repo secret) through OIDC from main, in the
 * partition's control-plane region. It runs versions.py from main's checkout (no npm install), and
 * hands build/versions.json to the `upgrade` job as an artifact. The upgrade job, which runs the
 * freshly upgraded npm packages, gets no id-token: in a private repo the deploy role trusts main's
 * OIDC subject, so a token there would let upgraded code assume it.
 */
export function upgradeWithVersionsRole(project: awscdk.AwsCdkTypeScriptApp, region: string): void {
  const wf = project.upgradeWorkflow?.workflows[0];
  if (!wf) return;
  const job = wf.getJob('upgrade') as { permissions?: Record<string, string>; steps?: Array<Record<string, unknown>>; needs?: string[] };
  const steps = [...(job.steps ?? [])];
  const at = steps.findIndex((st) => st.id === 'upgrade_dependencies');
  if (at < 0) throw new Error("cre: projen's upgrade-main workflow has no upgrade_dependencies step.");
  // A project without the file has nothing to look up (and nothing to hand over).
  const hasFile = `hashFiles('${VERSIONS_FILE}') != ''`;
  wf.addJob('versions', {
    name: 'Version lookups',
    runsOn: ['ubuntu-latest'],
    permissions: { contents: JobPermission.READ, idToken: JobPermission.WRITE },
    steps: [
      // The run's commit, as the upgrade job checks out: a merge between the two can't be reverted
      // by an older version file.
      { name: 'Checkout', uses: ACTIONS.checkout, with: { ref: '${{ github.sha }}' } },
      {
        name: 'AWS credentials for the version lookups (read-only)',
        if: hasFile,
        uses: ACTIONS.configureAwsCredentials,
        with: { 'role-to-assume': `\${{ secrets.${VERSIONS_ROLE_VARIABLE} }}`, 'aws-region': region },
      },
      { name: 'Move each version', if: hasFile, run: `python3 ${CRE_SCRIPTS}/build/versions.py update --file ${VERSIONS_FILE}` },
      {
        name: 'Hand the version file to the upgrade',
        if: hasFile,
        uses: ACTIONS.uploadArtifact,
        with: { 'name': VERSIONS_ARTIFACT, 'path': VERSIONS_FILE, 'retention-days': 1, 'if-no-files-found': 'error' },
      },
    ],
  });
  steps.splice(at, 0, {
    name: 'The version lookups\' file',
    if: hasFile,
    uses: ACTIONS.downloadArtifact,
    with: { name: VERSIONS_ARTIFACT, path: path.dirname(VERSIONS_FILE) },
  });
  const checkout = steps.findIndex((st) => st.id === 'checkout');
  if (checkout >= 0) steps[checkout] = { ...steps[checkout], with: { ...(steps[checkout].with as object), ref: '${{ github.sha }}' } };
  wf.updateJob('upgrade', { ...(job as object), needs: [...(job.needs ?? []), 'versions'], steps } as never);
}

/** The artifact the `versions` job hands the upgrade job (build/versions.json). */
const VERSIONS_ARTIFACT = 'versions';

/**
 * The `workflow` merge mode: a job after a passing build merges the PR with the App's token (so the
 * merge to main starts the deploy). It reads the PR fresh rather than trusting the event: still
 * open, labelled `auto-merge` (the git tasks add the labels just after opening it), a trusted
 * author, from this repository, and its head is still the commit that was built
 * (`--match-head-commit`); otherwise it skips. A newer commit's own build merges that one.
 */
export function addBuildMergeJob(project: awscdk.AwsCdkTypeScriptApp, github: GithubOptions): void {
  const wf = project.github?.tryFindWorkflow('build');
  if (!wf) throw new Error('cre: no build workflow to add the merge job to.');
  const trusted = trustedAuthors(github).join(' ');
  wf.addJob('merge', {
    needs: ['build'],
    runsOn: ['ubuntu-latest'],
    permissions: {},
    if: "github.event_name == 'pull_request' && needs.build.result == 'success' && " +
      '!needs.build.outputs.self_mutation_happened && github.event.pull_request.head.repo.full_name == github.repository',
    steps: [
      {
        name: 'Generate token',
        id: 'generate_token',
        uses: ACTIONS.createGithubAppToken,
        with: {
          'app-id': '${{ secrets.PROJEN_APP_ID }}',
          'private-key': '${{ secrets.PROJEN_APP_PRIVATE_KEY }}',
          'permission-contents': 'write',
          'permission-pull-requests': 'write',
        },
      },
      {
        name: 'Merge the PR (its build passed)',
        env: {
          GH_TOKEN: '${{ steps.generate_token.outputs.token }}',
          GH_REPO: '${{ github.repository }}',
          PR_NUMBER: '${{ github.event.pull_request.number }}',
          HEAD_SHA: '${{ github.event.pull_request.head.sha }}',
          // Who triggered this build: the pusher of a new commit, the labeler, the opener.
          SENDER: '${{ github.event.sender.login }}',
          TRUSTED: trusted,
        },
        run: [
          'set -euo pipefail',
          // A failed read fails the job (set -e), never a silent skip.
          'info=$(gh pr view "$PR_NUMBER" --repo "$GH_REPO" --json state,isDraft,author,headRefOid,labels ' +
            '--jq \'[.state, .isDraft, .author.login, .headRefOid, ([.labels[].name] | join(","))] | @tsv\')',
          'IFS=$\'\\t\' read -r state draft author head labels <<<"$info"',
          // gh reports an App author as app/<slug>; the trusted list names it <slug>[bot].
          'case "$author" in app/*) author="${author#app/}[bot]" ;; esac',
          'skip() { echo "Not merging: $1."; exit 0; }',
          '[ "$state" = OPEN ] || skip "the PR is $state"',
          '[ "$draft" = false ] || skip "the PR is a draft"',
          'case ",$labels," in *,auto-merge,*) ;; *) skip "no auto-merge label" ;; esac',
          'case " $TRUSTED " in *" $author "*) ;; *) skip "$author is not a trusted author" ;; esac',
          // A commit someone untrusted pushed onto a trusted author's PR waits for a person (review 10b D8).
          'case " $TRUSTED " in *" $SENDER "*) ;; *) skip "this build was started by $SENDER, who is not trusted" ;; esac',
          '[ "$head" = "$HEAD_SHA" ] || skip "the PR moved on to $head; its own build merges it"',
          'gh pr merge "$PR_NUMBER" --repo "$GH_REPO" --squash --match-head-commit "$HEAD_SHA"',
        ].join('\n'),
      },
    ],
  });
}

/** Exactly one provider. Each carries only its own settings. */
export type ProviderOptions =
  | { readonly gitlab: GitlabOptions; readonly github?: never }
  | { readonly github: GithubOptions; readonly gitlab?: never };

export interface CreDemoTemplateAppBaseOptions {
  readonly name: string;
  readonly description: string;
  readonly repository: string;
  /** @default 'Apache-2.0' */
  readonly license?: string;
  readonly deps?: string[];
  readonly devDeps?: string[];
  /**
   * Build and push container images (every `DockerImageAsset` in the CDK app). Gates the
   * container tasks AND the CI jobs together, so a job is never emitted without its asset.
   * @default false
   */
  readonly containerImages?: boolean;
  /**
   * The partition every stack deploys in: a stack's region outside it is refused, a CreIamStack /
   * CreDnsStack must be in its IAM / Route 53 control-plane region (us-east-1, us-gov-west-1,
   * cn-north-1 / cn-northwest-1, eusc-de-east-1), and a CreEdgeStack (CloudFront) exists only in
   * `aws`. @default 'aws'
   */
  readonly partition?: CrePartition;
  /** Extra .gitignore entries on top of the template's. */
  readonly additionalGitignore?: string[];
  /**
   * Default CloudFront Signer bindle for the deploy env's `BINDLE_ID` (a `BINDLE_ID` CI variable or
   * caller env overrides it). @default the aws-cre bindle
   */
  readonly bindleId?: string;
  /** Delete old deploy prefixes after each successful deploy (keeps current + 2). @default true */
  readonly pruneAssets?: boolean;
  /**
   * Generate no CI deploy: no GitHub `deploy` workflow, no GitLab deploy jobs. For a project whose
   * stacks were torn down on purpose, so a merge (or any later scheduled run) never recreates
   * them. The MR/PR build still runs, and `npx projen deploy` still deploys from a laptop.
   * @default false
   */
  readonly disableDeploy?: boolean;
  /**
   * Delete the stacks again after every deploy from main that succeeded, the daily image patch's
   * included: the deploy that creates them is the test, and nothing stays running to age into
   * security findings. A failed deploy stays up to be diagnosed. Stacks in another account
   * (`assumeRole`) are not deleted. Without it, the stacks stay up until a manual teardown (`npx
   * projen teardown`, or CI's: GitHub's `teardown` workflow, GitLab's `teardown` play button; `deploy:teardown` is the job this option adds).
   * @default false
   */
  readonly teardownAfterDeploy?: boolean;
  /**
   * The construct library's modules this project uses (core is always in): only these are installed
   * in cre-constructs/ and have their steering linked. Add one when the design needs it, then
   * `npx projen` installs it from the template clone. A public repository can't list the
   * Amazon-internal ones (CLOUDFRONT_SIGNER, FEDERATE_ALB).
   * @default [CreModule.CLOUDFRONT_SIGNER] in a private repository (the front door), [] in a public one;
   *   plus what the project type needs
   */
  readonly constructModules?: CreModule[];
  /**
   * Run the project's Python tests in `test`: `test:py` runs `python3 -m pytest src` (every
   * `test_*.py` under `src/`), and CI installs pytest (GitLab: Alpine's `py3-pytest`; GitHub:
   * Ubuntu's `python3-pytest`, before the build). @default false
   */
  readonly pythonTests?: boolean;
  /**
   * Steps that install what the project's own build needs (a .NET or Go toolchain), run before
   * every build: GitHub's PR build and the deploy's build job (`github`, workflow steps), GitLab's
   * `build:cdk` job (`gitlab`, shell lines run after the Alpine toolchain install). Only the
   * project's provider's list is used.
   */
  readonly buildSetup?: CreBuildSetup;
  /**
   * One approval per run before CI reaches AWS or Workshop Studio: the deploy, and on GitHub the
   * teardown and publish workflows too (src/workflows/approval.ts). GitHub: an `approve` job in the
   * `AWS-approval` environment, whose reviewer setup:repo sets (the person who runs it). GitLab: a
   * play-button job the deploy waits for. A scheduled deploy (the daily image patch) waits too.
   * @default true for a public GitHub repo, else false
   */
  readonly deployApproval?: boolean;
}

/** {@link CreDemoTemplateAppBaseOptions.buildSetup}: what each provider runs before the build. */
export interface CreBuildSetup {
  /**
   * Workflow steps before the build (e.g. `{ uses: 'actions/setup-dotnet', with: { 'dotnet-version': '9.0' } }`).
   * An action named without `@<ref>` takes its version from build/versions.json (a `github-action`
   * entry), pinned to the commit its tag points to.
   */
  readonly github?: JobStep[];
  /** Shell lines before the build on the Alpine image (e.g. `apk add --no-cache dotnet9-sdk`). */
  readonly gitlab?: string[];
}

/** Ubuntu's pytest on the GitHub build runner (the system python3, which `test:py` runs). */
const GITHUB_PYTEST_STEP = {
  name: 'Install pytest (pythonTests)',
  run: 'sudo apt-get update -q && sudo apt-get install -y -q --no-install-recommends python3-pytest',
};

/**
 * The GitHub steps before every build, the PR build's and the deploy's: QEMU for container images,
 * pytest for Python tests, then the project's own (buildSetup.github).
 */
export function githubPreBuildSteps(options: CreDemoTemplateAppBaseOptions & { outdir?: string }): JobStep[] {
  return [
    ...(options.containerImages ? [GITHUB_QEMU_STEP] : []),
    ...(options.pythonTests ? [GITHUB_PYTEST_STEP] : []),
    ...pinActions(options.buildSetup?.github ?? [], options.outdir ?? process.cwd()),
  ];
}

export type CreDemoTemplateAppOptions = CreDemoTemplateAppBaseOptions & ProviderOptions;

/** What a concrete project type adds to the base's pipeline. */
export interface ProjectTypeExtras {
  /** Secrets its build reads (the PR build and the deploy's Build step). */
  readonly buildSecrets?: readonly string[];
  /** A release (tag + release notes) of the commit every deploy from main that succeeded tested (`release` task). */
  readonly release?: boolean;
  /**
   * Paths a deploy doesn't depend on (git and GitHub globs: `*` stays in one directory). On GitHub
   * a push to main that changes only these doesn't deploy, and a release's code check leaves them out.
   */
  readonly nonDeployPaths?: readonly string[];
  /** Paths whose change on main releases without a deploy, the code being the latest release's (the guide). */
  readonly guidePaths?: readonly string[];
}

const BASE_GITIGNORE = [
  // The project's own steering is committed; the template's steering, skills and agent docs are
  // local-only (localOnlyIgnores, appended below), and so are an agent's working files: .agents/
  // (PDD's planning) and .kiro/specs/.
  '/.agents/',
  '.kiro/specs/',
  'idea/',
  // Claude Code per-machine state: agent worktrees (embedded git repos that `--files "."` would
  // commit as gitlinks) and local permissions.
  '.claude/worktrees/',
  '.claude/settings.local.json',
  '.DS_Store',
  '**/.DS_Store',
  'tsconfig.tsbuildinfo',
  'coverage/',
  'test-reports/',
  'cdk.out*/',
  // Setup's local links (.cre/gitlab-token, the GitLab token file).
  '.cre/',
  // Credentials never belong in the repo (npx projen push also refuses them).
  '.env',
  '.env.*',
  '!.env.example',
  '*.pem',
  '*.key',
  '.netrc',
  '.aws/',
  '*.har',
  // Cookie files (a Midway cookie is a live credential): the jar names curl and our scripts use.
  'cookies.txt',
  'cookie',
  'cookie.txt',
  '*.cookie',
  '*cookie-jar*',
  '.midway/',
  'dist/',
  // The package's assets (package:assets): the root's only, not an app's own assets/ folder.
  '/assets/',
  'tmp/',
  '/lib/',
  '*.d.ts',
  'node_modules/',
  '__pycache__/',
  '*.pyc',
  '.venv/',
  'venv/',
  '*.egg-info/',
];

/** CVE transitive pins (gotcha 11), applied on both providers. */
const RESOLUTIONS = [
  'flatted@>=3.4.2',
  'fast-xml-parser@>=5.7.0',
  'fast-xml-builder@>=1.2.0',
  'fast-uri@>=3.1.2',
  'handlebars@>=4.7.9',
  'picomatch@>=2.3.2',
  'uuid@>=14.0.0',
];

/**
 * The common base for every CRE project type. Owns everything the recipe's MUST-HONOR rules used
 * to ask an agent to keep by hand: the pinned toolchain, tsconfig/eslint shape, the provider's
 * CI/CD, the build/deploy tasks, the git tasks, template updates, and the base steering.
 *
 * Not instantiated directly: use CreResilienceDemo, CreFailureScenario or CreCustomerSandbox.
 */
/** pythonProblem's answer, asked once per process ('' when python3 is new enough). */
let checkedPython: string | undefined;

export abstract class CreDemoTemplateApp extends awscdk.AwsCdkTypeScriptApp {
  public readonly gitProvider: GitProvider;
  /** One approval before CI deploys (deployApproval, resolved). */
  public readonly deployApproval: boolean;
  public readonly layout: ProjectLayout;
  /** The stacks the pipeline deploys, in deploy order (from the CDK app). */
  public readonly plannedStacks: readonly PlannedStack[];

  /** The construct modules this project has (resolveModules): installed in cre-constructs/. */
  public readonly constructModules: readonly CreModule[];

  protected constructor(options: CreDemoTemplateAppOptions, layout: ProjectLayout, typeSteering: string, extraSteering: string[] = [],
    requiredModules: readonly CreModule[] = [], typeOptions: ProjectTypeExtras = {}) {
    const buildSecrets = typeOptions.buildSecrets ?? [];
    // Every task is Python: refused up front on a python3 older than MIN_PYTHON, not mid-task.
    const python = checkedPython ??= pythonProblem() ?? '';
    if (python) {
      console.error(`cre: npx projen FAILED: ${python}.`);
      process.exit(1);
    }
    const isGithub = options.github !== undefined;
    // Before anything is written: a public repository listing an Amazon-internal module is refused.
    let modules: CreModule[] = [];
    try {
      modules = resolveModules(options.constructModules, requiredModules, isGithub && options.github!.visibility === 'public');
    } catch (e) {
      if (process.env.JEST_WORKER_ID) throw e;
      console.error(`cre: npx projen FAILED: ${(e as Error).message}`);
      process.exit(1);
    }
    if (options.teardownAfterDeploy && options.disableDeploy) {
      throw new Error('CreDemoTemplateApp: teardownAfterDeploy needs a deploy to tear down; it can\'t be set with disableDeploy.');
    }
    if (isGithub === (options.gitlab !== undefined)) {
      throw new Error('CreDemoTemplateApp: set exactly one of `gitlab` or `github`.');
    }
    const devdirs = [...layout.cdkDirs, 'test', '.projenrc.ts', 'projenrc'];
    // GitHub only: a GitLab project merges with GitLab's own auto-merge.
    const mergeMode = isGithub ? githubMergeMode(options.github!) : undefined;
    // Pinned, from build/versions.json, which the scheduled upgrade moves (components/cdk-version.ts).
    const cdk = cdkVersion((options as { outdir?: string }).outdir ?? process.cwd());

    super({
      // Not a public option: tests construct projects in a scratch directory.
      ...((options as { outdir?: string }).outdir ? { outdir: (options as { outdir?: string }).outdir } : {}),
      name: options.name,
      description: options.description,
      repository: options.repository,
      license: options.license ?? 'Apache-2.0',
      deps: [
        // The construct library, installed into ./cre-constructs by the scaffold and by
        // update-template. A link: dependency, so it resolves like any package.
        `${CRE_CONSTRUCTS_PACKAGE}@link:./${CRE_CONSTRUCTS_DIR}`,
        ...(options.deps ?? []),
      ],
      devDeps: ['@types/node', ...(options.devDeps ?? [])],
      peerDeps: [],

      // ---- pinned toolchain (formerly MUST-HONOR rules 1, 2, 12, 13) ----
      defaultReleaseBranch: 'main',
      projenrcTs: true,
      projenVersion: PROJEN_VERSION,
      cdkVersion: cdk,
      cdkVersionPinning: true,
      constructsVersion: '10.5.0',
      typescriptVersion: '~5.6.3',
      appEntrypoint: layout.appEntrypoint,
      srcdir: 'src',
      testdir: 'test',
      sampleCode: false,
      // `test` never rewrites snapshots, so a changed one fails (in CI too); `test:update` updates
      // them on purpose (review N4).
      jestOptions: {
        updateSnapshot: UpdateSnapshot.NEVER,
        // cre-constructs uses NodeNext `.js` import specifiers for its .ts files; without the
        // mapper a test that imports @cre/constructs fails to resolve them (review 10b A3).
        // The global setup/teardown give each run its own temp directory and delete it, with the
        // `cdk.out*` directory every test app synthesizes into (gigabytes a day otherwise).
        jestConfig: {
          moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
          globalSetup: `<rootDir>/${CRE_SCRIPTS}/jest/global-setup.js`,
          globalTeardown: `<rootDir>/${CRE_SCRIPTS}/jest/global-teardown.js`,
        },
      },
      featureFlags: awscdk.CdkFeatureFlags.V2.ALL,
      packageManager: NodePackageManager.YARN_BERRY,
      minNodeVersion: `${NODE_MAJOR}.0.0`,
      workflowNodeVersion: NODE_MAJOR,
      yarnBerryOptions: {
        yarnRcOptions: { nodeLinker: javascript.YarnNodeLinker.NODE_MODULES },
      },
      tsconfig: { compilerOptions: { isolatedModules: true } },
      tsconfigDev: { compilerOptions: { isolatedModules: true } },
      eslintOptions: {
        dirs: ['src', 'test'],
        devdirs, // formerly MUST-HONOR rule 4
        ignorePatterns: ['*.d.ts', '*.js', 'node_modules/', 'lib/'],
      },
      gitignore: [...BASE_GITIGNORE, ...localOnlyIgnores(), ...(options.additionalGitignore ?? [])],
      // A CDK app is never published to npm: no .npmignore in every project (review 10d G7).
      npmignoreEnabled: false,

      // ---- provider seam ----
      github: isGithub,
      ...(isGithub
        ? {
          workflowRunsOn: ['ubuntu-24.04-arm'],
          buildWorkflow: true,
          // gotcha 3; QEMU so build:docker can build an image for the other architecture.
          buildWorkflowOptions: {
            mutableBuild: true,
            // The deploy's build job's runner (projen's build workflow ignores workflowRunsOn): a PR
            // builds on the architecture main builds on, so an arm64 image's RUN steps run natively.
            runsOn: ['ubuntu-24.04-arm'],
            preBuildSteps: githubPreBuildSteps(options),
            // The secrets the type's build reads (a workshop's build tool location); the deploy's
            // build job gets the same. GitLab passes its CI/CD variables to every job itself.
            env: secretsEnv(buildSecrets),
          },
          // No releases: nothing consumes them yet, and an adopted repo's own tags became the
          // version line, publishing a release in its numbering (review 10h D3). Git history has
          // the workflow (src/workflows/release-workflow.ts) for when releases are wanted.
          release: false,
          dependabot: false,
          depsUpgrade: true,
          depsUpgradeOptions: {
            workflowOptions: {
              labels: ['auto-approve', 'auto-merge'],
              schedule: UpgradeDependenciesSchedule.DAILY,
              // Named for its branch (upgrade-main, github-actions/upgrade-main) without a release
              // to take the branch from: the guard and BOT_BRANCHES read those names.
              branches: ['main'],
            },
          },
          // A trusted author's PR labelled auto-approve is approved. It merges only after its build
          // passes (githubMergeMode): public repos through auto-queue (GitHub auto-merge, which
          // main's branch protection makes wait for the build), private ones through the build
          // workflow's merge job. The merge deploys (deploy.yml).
          autoApproveOptions: { allowedUsernames: trustedAuthors(options.github!), label: 'auto-approve' },
          githubOptions: {
            mergify: false,
            mergeQueue: mergeMode === 'auto-merge',
            mergeQueueOptions: {
              autoQueueOptions: { allowedUsernames: trustedAuthors(options.github!), labels: ['auto-approve', 'auto-merge'] },
            },
            // gotcha 3: the workflow's own GITHUB_TOKEN can't do this (what it pushes, opens or merges
            // starts no workflow). The builder's GitHub App (GithubOptions.appSlug).
            projenCredentials: projenCredentials(options.github!),
            // Every Conventional Commits type, as the git tasks accept (projen's default is only
            // feat, fix and chore, so a `docs:` or `test:` PR would fail its title check).
            pullRequestLintOptions: { semanticTitleOptions: { types: [...CONVENTIONAL_TYPES] } },
          },
        }
        : {}),
    });

    this.gitProvider = isGithub ? 'github' : 'gitlab';
    this.deployApproval = options.deployApproval ?? (isGithub && options.github!.visibility === 'public');
    this.layout = layout;
    new CdkVersionEntry(this, cdk);
    const containerImages = options.containerImages ?? false;
    // The stacks come from the CDK app: a plan-only synth (no bundling, no asset staging) records
    // every CreStack's deploy settings and parameter sources; when the app can't be synthesized yet
    // (fresh clone, no node_modules, a compile error), the committed cre-stacks.json is used.
    // The project name reaches the app as cdk.json context (CreApp.stackId()).
    this.cdkConfig.json.addOverride('context.cre:projectName', this.name);
    // Every CDK v2 feature flag is on but this one. It gives each Lambda function a log group CDK names
    // `/aws/lambda/<function>`, so a construct that makes that log group itself (the older pattern,
    // e.g. @cdklabs/multi-az-observability's) fails the deploy with "already exists" (multi-az-workshop,
    // 2026-11-17). Off: Lambda makes the group, as before the flag.
    this.cdkConfig.json.addOverride('context.@aws-cdk/aws-lambda:useCdkManagedLogGroup', false);
    // The construct modules first: the app may use one this run brings in (a new module, a template update).
    installConstructModules(this.outdir, modules, (outdir) => templateClone(outdir));
    const read = readPlan(this.outdir, this.name, cdkAppCommand(this.srcdir, layout.appEntrypoint, this.tsconfig?.fileName));
    if (read.source !== 'synth') {
      const why = read.detail ? ` (${read.detail})` : '';
      console.warn(read.source === 'committed'
        ? `cre: using the ${PLAN_FILE} on disk (from the last npx projen that synthesized): the CDK app was not synthesized${why}. ` +
          'Run npx projen again once it synthesizes.'
        : `cre: no stacks yet: the CDK app was not synthesized and there is no ${PLAN_FILE}${why}. Run npx projen again after the install.`);
      // A compile or synth error: the files are still written (so a dependency this run adds gets
      // installed), but `npx projen` exits non-zero, so neither an agent nor `build` moves on with a
      // stale plan (review 10b A5). Not under jest, where it would fail the test run.
      if (read.failed && !process.env.JEST_WORKER_ID) {
        const first = firstSynthError(read.detail ?? '');
        console.error(`cre: npx projen FAILED${first ? `: ${first.replace(/\.$/, '')}` : ''}. Fix the CDK app (the full error is above), then run npx projen again.`);
        process.exitCode = 1;
      }
    }
    let stacks: ReturnType<typeof planStacks>;
    try {
      stacks = planStacks(this.name, read.stacks, options.partition);
    } catch (e) {
      // A plan error (a cycle, a misplaced stack) is the app's to fix: one line, not a stack trace.
      if (process.env.JEST_WORKER_ID) throw e;
      console.error(`cre: npx projen FAILED: ${(e as Error).message}`);
      process.exit(1);
    }
    if (read.source === 'synth') warnLeftThePlan(this.outdir, stacks.map((st) => st.id));
    this.plannedStacks = stacks;
    const stackIds = stacks.map((st) => st.id);
    const deployOpts = { containerImages, pruneAssets: options.pruneAssets };
    // One deploy job per stack: the same variables in GitLab, GitHub and the local deploy.
    const jobDefaults = { BINDLE_ID: options.bindleId ?? DEFAULT_BINDLE_ID };
    const jobs = stackJobs(stacks, jobDefaults);
    // The plan the pipeline was generated from, committed: the record a reviewer sees, the fallback
    // above, and what check:stack-plan compares every synth with.
    writePlanFile(this, read.stacks, stacks, jobs, jobDefaults);

    this.package.addPackageResolutions(...RESOLUTIONS);
    this.tasks.addEnvironment('PROJECT_NAME', this.name);
    // watch.py stops at "merged": with no CI deploy there is nothing after it to follow.
    if (options.disableDeploy) this.tasks.addEnvironment('CRE_DEPLOY_DISABLED', '1');

    // `cdk synth` runs via ts-node in CommonJS mode, which can't map the vendored construct
    // barrels' `.js` specifiers to `.ts` sources without the experimental resolver (gotcha 9:
    // set by override, never by editing tsconfig.json).
    this.tryFindObjectFile('tsconfig.json')?.addOverride('ts-node', { experimentalResolver: true });

    // The `ci:build:*` entry points are GitLab's: GitHub's workflows run `projen build` (review 10c G2).
    createBuildTasks(this, { containerImages, stackIds, ciEntryPoints: !isGithub });
    createDeployTasks(this, stacks, deployOpts);

    if (isGithub) {

      // gotcha 5: projen's AutoQueue ignores labels added after a PR opens unless `labeled` is listed.
      this.github?.tryFindWorkflow('auto-queue')?.file?.addOverride('on.pull_request_target.types', [
        'opened',
        'reopened',
        'ready_for_review',
        'labeled',
      ]);
      approveOncePerLabel(this, options.github!);
      guardGithubUpgradeBranch(this);
      upgradeWithVersionsRole(this, IAM_CONTROL_PLANE_REGION[options.partition ?? 'aws']);
      if (mergeMode === 'workflow') addBuildMergeJob(this, options.github!);
      if (!options.disableDeploy) {
        createDeployWorkflow(this.github!, {
          preBuildSteps: githubPreBuildSteps(options),
          buildSecrets,
          release: typeOptions.release,
          nonDeployPaths: typeOptions.nonDeployPaths,
          guidePaths: typeOptions.guidePaths,
          teardownAfterDeploy: options.teardownAfterDeploy,
          containerImages,
          projectName: this.name,
          credentialsRegion: IAM_CONTROL_PLANE_REGION[options.partition ?? 'aws'],
          jobs,
          pruneAssets: options.pruneAssets,
          roleDurationSeconds: GITHUB_ROLE_SECONDS,
          publicRepo: mergeMode === 'auto-merge',
          environment: options.github!.visibility === 'public' ? DEPLOY_ENVIRONMENT : undefined,
          approval: this.deployApproval,
        });
      }
    } else {
      createGitlabWorkflow(this, {
        containerImages,
        credentialsRegion: IAM_CONTROL_PLANE_REGION[options.partition ?? 'aws'],
        jobs,
        defaults: jobDefaults,
        release: typeOptions.release,
        nonDeployPaths: typeOptions.nonDeployPaths,
        pruneAssets: options.pruneAssets,
        disableDeploy: options.disableDeploy,
        teardownAfterDeploy: options.teardownAfterDeploy,
        pythonTests: options.pythonTests,
        buildSetup: options.buildSetup?.gitlab,
        approval: this.deployApproval,
      });
    }

    createGitTasks(this, this.gitProvider);
    createTemplateTasks(this);
    createToolingTasks(this, this.gitProvider, {
      name: this.name,
      provider: this.gitProvider,
      repository: options.repository,
      partition: options.partition,
      githubEnvironment: isGithub && options.github!.visibility === 'public' ? DEPLOY_ENVIRONMENT : undefined,
      githubAppSlug: options.github?.appSlug,
      githubApproval: isGithub && this.deployApproval,
    }, modules.includes(CreModule.CLOUDFRONT_SIGNER));
    this.constructModules = modules;
    // The modules come over from the template clone on `npx projen` (a laptop); CI checks they did.
    new LocalOnlyFiles(this, (outdir) => templateClone(outdir));
    new ConstructModules(this, modules, (outdir) => templateClone(outdir));
    // @cre/constructs is a dependency: a hand edit to the installed copy, or modules other than these, fail the build.
    this.testTask.prependExec(`python3 ${CRE_SCRIPTS}/template/verify-constructs.py --modules "${modules.join(',')}" ${CRE_CONSTRUCTS_DIR}`);
    if (options.pythonTests) {
      // No cache dir: a .pytest_cache under src/ would read as an uncommitted change.
      this.testTask.spawn(this.addTask('test:py', {
        description: "Run the project's Python tests (every test_*.py under src/) with pytest",
        exec: 'python3 -m pytest src -q -p no:cacheprovider',
      }));
    }
    this.gitattributes.addAttributes(`/${CRE_CONSTRUCTS_DIR}/**`, 'linguist-vendored');
    createSkillsTasks(this);
    createSteering(this, typeSteering, isGithub ? 'github' : 'gitlab', [...extraSteering, ...modules.flatMap(moduleSteering)]);
  }

  /** After .projenrc.ts has added its own tasks: refuse a download without retries in any of them. */
  public override preSynthesize(): void {
    super.preSynthesize();
    refuseUnretriedDownloads(this.tasks.all);
  }
}

