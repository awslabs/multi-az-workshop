import type { awscdk } from 'projen';
import { CRE_SCRIPTS } from '../paths';

/** Runs a script from the template clone (scripts/lib/template.py): a project doesn't commit them. */
const FROM_TEMPLATE = `python3 ${CRE_SCRIPTS}/lib/template.py`;

/**
 * `npx projen update-template` — pull the template clone, refresh this package (projenrc/cre/), the
 * construct library and the skill links from it, then re-synth and build. See scripts/template/update-template.py.
 * It runs the template clone's own script. (A fresh clone gets its local-only files on `npx projen`:
 * src/local-only.ts LocalOnlyFiles.)
 */
export function createTemplateTasks(project: awscdk.AwsCdkTypeScriptApp): void {
  project.addTask('update-template', {
    description:
      // Which clone it uses lives in one place, the --from entry of the task reference (review 10d G3).
      'Pull the cre-demo-template clone, refresh projenrc/cre, cre-constructs and the skill links from it, then synth + build.',
    steps: [{ exec: `${FROM_TEMPLATE} template/update-template.py --from "{template}" "$@"`, receiveArgs: true }],
  });
}
