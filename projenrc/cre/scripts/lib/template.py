#!/usr/bin/env python3
"""template.py <script> [args...] — run one of the package's scripts from the template clone.

What only a laptop needs is never committed in a project (src/local-only.ts), so a fresh clone has
none of it, including the updater. `npx projen update-template` starts here, the one committed piece of that bridge: it finds the cre-demo-template clone the way
every script does (crelib.project_template_dir: the recorded one, else the sibling directory
SOURCE.json names), or the one `--from <path>` names (taken out of the arguments), and runs its
packages/cre-projen/scripts/<script> with the rest, `{template}` replaced by the clone's path.
Exit 10 (and the script's `RESULT code=10 step=<name>` line) when there is no clone; otherwise the
script's own exit code.
"""
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crelib as c  # noqa: E402

REFUSED = 10


USAGE = """usage: template.py <script under packages/cre-projen/scripts> [--from <path>] [args...]

  --from <path>  the cre-demo-template clone (else $CRE_TEMPLATE_DIR, the recorded one, the sibling)"""


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(USAGE)
        return 0 if argv else REFUSED
    script, args = argv[0], list(argv[1:])
    given = os.environ.get("CRE_TEMPLATE_DIR", "")
    # The builder's --from (any but the task's own `--from {template}`): used to find the clone, then
    # taken out; the script gets the clone as `{template}`.
    i = 0
    while i < len(args) - 1:
        if args[i] == "--from" and args[i + 1] != "{template}":
            given = args[i + 1]
            del args[i:i + 2]
        else:
            i += 1
    tpl = os.path.realpath(os.path.expanduser(given)) if given else c.project_template_dir(".")
    # A refusal ends as the script's own would: its RESULT line, so a caller reads the code (review 10e F1).
    step = os.path.splitext(os.path.basename(script))[0]
    if not c.is_template_clone(tpl):
        print(f"RESULT code={REFUSED} step={step}")
        print(f"No cre-demo-template clone {'at ' + given if given else 'recorded for this project or beside it'}. "
              "Clone it beside the project, or pass --from <path to your clone> (it is recorded for next time).", file=sys.stderr)
        return REFUSED
    path = os.path.join(tpl, "packages", "cre-projen", "scripts", *script.split("/"))
    if not os.path.isfile(path):
        print(f"RESULT code={REFUSED} step={step}")
        print(f"The template clone at {tpl} has no scripts/{script}: pull it (git -C {tpl} pull).", file=sys.stderr)
        return REFUSED
    os.execv(sys.executable, [sys.executable, path, *[a.replace("{template}", tpl) for a in args]])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
