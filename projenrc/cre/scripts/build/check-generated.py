#!/usr/bin/env python3
"""check:generated — in CI, fail when the committed generated files (the pipeline, cre-stacks.json,
package.json, tasks, steering, ...) aren't what `npx projen` makes from .projenrc.ts and the CDK app.
Otherwise the build regenerates them first and `check:stack-plan` compares the app with a plan
regenerated from that same app: it always passes, and the committed pipeline that GitLab or GitHub
actually runs may be stale (review #15).

Runs only on a clean checkout in CI ($CI set): locally a work-in-progress tree is expected to
differ, and `npx projen` there is the fix, not a failure. Exit 0 current (or skipped) | 1 stale,
a dirty checkout, or `npx projen` failed.
"""
import os
import sys

sys.dont_write_bytecode = True  # never a __pycache__ in the template clone or projenrc/cre
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import crelib  # noqa: E402


def porcelain():
    return crelib.git("status", "--porcelain", cwd=None).stdout.rstrip("\n")


def main():
    if not os.environ.get("CI"):
        print("check:generated: not in CI; skipped (run npx projen to regenerate).")
        return 0
    dirty = porcelain()
    if dirty:
        # In CI the checkout is clean, so a dirty one is the anomaly: skipping would let a stale
        # committed pipeline through, the case this check exists for (review 10b D16).
        print("❌ check:generated: the CI checkout isn't clean before regenerating, so the committed files can't be compared:\n"
              f"{dirty}\n   A step before this one changed the tree; run check:generated before it.", file=sys.stderr)
        return 1
    r = crelib.run(["npx", "projen"])
    if r.returncode != 0:
        print(r.stdout + r.stderr, file=sys.stderr)
        print("check:generated: npx projen failed.", file=sys.stderr)
        return 1
    changed = porcelain()
    if changed:
        print("❌ The committed generated files are stale: npx projen changes these:", file=sys.stderr)
        print("\n".join("   " + line for line in changed.splitlines()), file=sys.stderr)
        print(crelib.git("--no-pager", "diff", "--stat", cwd=None).stdout.rstrip("\n"), file=sys.stderr)
        print("   Run npx projen, commit what it changes (with the change that caused it), and push.", file=sys.stderr)
        return 1
    print("✅ check:generated: the committed generated files are current.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
