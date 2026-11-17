import type { awscdk } from 'projen';
import { CRE_SCRIPTS } from '../paths';

export type GitProvider = 'gitlab' | 'github';

/**
 * The provider-neutral git tasks every CRE project gets:
 *
 *   npx projen branch <type>/<description>     start new work from a fresh origin/main
 *   npx projen git:status                      read-only: classify the repo, say what push would do
 *   npx projen commit --message "<msg>"        validate (synth + build), stage, commit; no push
 *   npx projen push --message "<msg>" [--title "<t>"] [--branch <new>] [--files "<paths>"]
 *   npx projen watch [<n> | --branch <b> | --sha <s>] [--until checks|merged|deployed]
 *                                              read-only: one MR/PR from checks to its deploy
 *
 * The logic is in `scripts/git/` (Python 3.9+, standard library; bundled with this package,
 * vendored to projenrc/cre/scripts/git) and pinned by the scenario harness in `test/git/run.sh`.
 * Exit codes: 0 done, 10 refused with nothing changed, 20 validation/hook failed, 30 conflict with
 * the repo restored, 40 incomplete (this run committed, branched or pushed, then stopped; a re-run
 * resumes). The last stdout line is always a `RESULT ...` line.
 *
 * Every exec uses the quoted `"$@"` marker. A plain exec with `receiveArgs` splits
 * `--message "feat: add two words"` into four arguments (verified on projen 0.101.35 and 0.104.8).
 * `push` runs one script rather than spawning the other tasks, because a spawned task receives the
 * parent's whole argument list.
 */
export function createGitTasks(project: awscdk.AwsCdkTypeScriptApp, provider: GitProvider): void {
  const env = { CRE_GIT_PROVIDER: provider };
  const add = (name: string, script: string, description: string) =>
    project.addTask(name, {
      description,
      env,
      steps: [{ exec: `python3 ${CRE_SCRIPTS}/git/${script} "$@"`, receiveArgs: true }],
    });

  add('branch', 'branch.py', "Start new work: create <name> from origin's default branch (just fetched), carrying uncommitted changes.");
  add('git:status', 'status.py', 'Classify the repo state and say what `push` would do. Changes nothing (it only fetches).');
  add('commit', 'commit.py', 'Validate (synth + build), stage and commit. Never pushes. Needs --message.');
  add(
    'push',
    'push.py',
    'Validate, commit, push, open/update the MR/PR and arm auto-merge. Needs --message; --branch when a new branch is needed.',
  );
  // Replaces projen's own `watch` (cdk watch: deploys straight from this machine with hotswap,
  // around the pipeline), which a project must never run.
  project.tasks.removeTask('watch');
  project.addTask('watch', {
    description: 'Read-only: follow an MR/PR from its checks through the merge to the deploy of its merge commit. [<n>|--branch b|--sha s] [--until checks|merged|deployed]',
    env,
    steps: [{ exec: `python3 ${CRE_SCRIPTS}/git/watch.py "$@"`, receiveArgs: true }],
  });
  project.addTask('ci:rerun', {
    description: "Retry the failed jobs of the deploy of main's head; --all runs the whole deploy again. Then: npx projen watch --sha <sha>.",
    env,
    steps: [{ exec: `python3 ${CRE_SCRIPTS}/git/ci.py "$@"`, receiveArgs: true }],
  });
}
