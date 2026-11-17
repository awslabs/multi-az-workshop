#!/usr/bin/env python3
"""synth:silent — `cdk synth -q`, accepting an app with no stacks.

The CDK CLI exits 1 with "This app contains no stacks" for an app that synthesizes none, after the
app ran and wrote cdk.out (manifest.json, and CreApp's cre-stacks.json). A fresh scaffold has no
stacks on purpose (the project's design adds them), so that one case is a success here; every other
failure is passed through with its output and exit code. Arguments go on to cdk.
"""
import os
import sys

sys.dont_write_bytecode = True  # never a __pycache__ in the template clone or projenrc/cre
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import crelib  # noqa: E402


def main(argv):
    r = crelib.run(["cdk", "synth", "-q", *argv])
    out = (r.stdout + r.stderr).rstrip("\n")
    if r.returncode == 0:
        # `cdk synth -q` of an app with several stacks ends "Supply a stack id (...) to display its
        # template.": advice for a person at a terminal, printed on every build (review 10g A4).
        out = "\n".join(ln for ln in out.splitlines() if not ln.startswith("Supply a stack id"))
        if out:
            print(out)
        return 0
    if "This app contains no stacks" in out and os.path.isfile(os.path.join("cdk.out", "manifest.json")):
        print("cdk synth: the app has no stacks yet (nothing to deploy).")
        return 0
    print(out, file=sys.stderr)
    return r.returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
