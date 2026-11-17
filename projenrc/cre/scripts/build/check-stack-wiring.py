#!/usr/bin/env python3
"""Fail the build when stacks are wired with CloudFormation exports instead of outputs -> parameters.

    check-stack-wiring.py [cdk.out]

Reads every synthesized template under the cloud assembly (nested stacks and stages included)
and reports, per file:
  - an Output with an `Export` (what `exportName`, or CDK passing a token between stacks, emits);
  - any `Fn::ImportValue`;
  - a `Custom::CrossRegionExportWriter` / `Reader` resource (CDK's `crossRegionReferences`).

Why: an export locks both stacks (the exporter can't change or delete the value while anything
imports it), can't cross regions or accounts, and makes the deploy order CDK's instead of the
project's. Stacks here pass values as an output and a parameter of the same name, which the
deploy fills automatically (steering cre-pipelines.md).

Runs right after `cdk synth` (post-compile, and ci:build:cdk), because it checks what synth wrote.
Exit 0 when clean, 1 with a report otherwise, 2 when there's no cloud assembly to check.
"""
import json
import pathlib
import sys

CROSS_REGION_TYPES = {"Custom::CrossRegionExportWriter", "Custom::CrossRegionExportReader"}


def find_imports(node, path):
    """Yield the JSON path of every Fn::ImportValue under node."""
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "Fn::ImportValue":
                yield path
            else:
                yield from find_imports(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from find_imports(v, f"{path}[{i}]")


def check_template(template):
    problems = []
    for name, out in (template.get("Outputs") or {}).items():
        if isinstance(out, dict) and "Export" in out:
            problems.append(f"Outputs.{name} has an Export")
    for p in find_imports({k: v for k, v in template.items() if k != "Metadata"}, ""):
        problems.append(f"Fn::ImportValue at {p.lstrip('.')}")
    for name, res in (template.get("Resources") or {}).items():
        t = res.get("Type") if isinstance(res, dict) else None
        if t in CROSS_REGION_TYPES or (isinstance(t, str) and t.startswith("Custom::CrossRegionExport")):
            problems.append(f"Resources.{name} is {t} (crossRegionReferences)")
    return problems


def main(argv):
    root = pathlib.Path(argv[1] if len(argv) > 1 else "cdk.out")
    files = sorted(root.rglob("*.template.json")) if root.is_dir() else []
    if not files:
        if (root / "manifest.json").is_file():
            # Synthesized, with no stacks (a fresh scaffold): nothing to check.
            print("check-stack-wiring: 0 templates (the app has no stacks yet).")
            return 0
        print(f"check-stack-wiring: no templates under {root}; run cdk synth first.", file=sys.stderr)
        return 2
    report = {}
    for f in files:
        problems = check_template(json.loads(f.read_text()))
        if problems:
            report[str(f.relative_to(root))] = problems
    if not report:
        print(f"check-stack-wiring: {len(files)} template(s), no exports or imports.")
        return 0
    print("check-stack-wiring: stacks are wired with CloudFormation exports/imports.", file=sys.stderr)
    for f, problems in report.items():
        print(f"  {f}", file=sys.stderr)
        for p in problems:
            print(f"    - {p}", file=sys.stderr)
    print(
        "Pass a value between stacks with a CreCfnParameter in the later stack:\n"
        "  new CreCfnParameter(this, 'BucketName', { from: { stack: storage, value: storage.bucket.bucketName } })\n"
        "(it adds the output to the earlier stack and the deploy fills the parameter). Never exportName /\n"
        "Fn.importValue, and never hand a construct or token (a VPC, a function's metric) from one stack to\n"
        "another: that is what makes these exports. See cre-pipelines.md.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
