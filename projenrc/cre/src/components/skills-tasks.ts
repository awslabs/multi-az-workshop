import type { awscdk } from 'projen';
import { CRE_SCRIPTS } from '../paths';

/**
 * Provider-AGNOSTIC diagnostics for the demo's vended agent skills.
 *
 * Part of the cre-projen package, called by CreDemoTemplateApp for both providers.
 *
 * ## Why this task exists
 *
 * The skills under `.kiro/skills/` are **symlinks** back to `<cre-demo-template>/skills/` (recipe
 * STEP 3), so pulling the template updates every demo on the machine at once and no demo carries a
 * stale copy. The price is a failure mode with no error message: rename, move, or simply not have
 * the template, and every link dangles while `git status` stays clean and nothing fails. The skill
 * just stops being listed by the harness. `npx projen skills:doctor` turns that silence into a
 * report naming each link and its target.
 *
 * The logic lives in `scripts/build/skills-doctor.py`, NOT in the `exec` string here: projen's dax shell
 * does not expand braced `${VAR}`, and the `bash -c` escape hatch forbids single quotes in its
 * payload (MUST-HONOR rules 14/15). A real script file is subject to neither.
 *
 * Deliberately NOT wired into the `build` task. A dangling skill link says nothing about whether
 * the demo compiles, synthesizes or deploys — the build never reads `.kiro/` — so failing the green
 * gate on it would be wrong, and would break CI, where the template is legitimately absent.
 */
export function createSkillsTasks(project: awscdk.AwsCdkTypeScriptApp): void {
  project.addTask('skills:doctor', {
    description:
      'Check that the vended agent skills (.kiro/skills/* symlinks into cre-demo-template) resolve.',
    steps: [{ exec: `python3 ${CRE_SCRIPTS}/build/skills-doctor.py` }],
  });
}
