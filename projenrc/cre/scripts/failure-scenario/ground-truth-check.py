#!/usr/bin/env python3
"""test:ground-truth — validate a CreFailureScenario's answer key.

    ground-truth-check.py <file.jsonl> [--clean-dir src/clean]

JSON Lines, one scenario object per line (format of request-router-metadata-app's
arch-045-ground-truth.jsonl):

    {"id": str, "category": "ngrh_real", "notes": str, "findings": [finding, ...]}

category: "ngrh_real" (ngrh: Next Gen Resilience Hub; _real: a real finding, not a non-issue).

finding:
    finding_id      unique across the file
    type            "gap" | "non-issue"
    severity        gap: "high" | "medium" | "low";  non-issue: "non-issue"
    raf_category    one of the five Resilience Analysis Framework failure categories; required on
                    gaps, optional on non-issues
    rel_category    "REL-01" … "REL-13", the Well-Architected Reliability pillar question it falls
                    under (optional on non-issues)
    location_hint   "<path> [symbol / note]"; several joined with " + ". A path is repo-relative
                    (src/clean/app/x.rs) or relative to the clean dir (app/x.rs); either way it must
                    exist under the clean dir.
    description     non-empty
    expected_recommendation   gaps: what a good reviewer should recommend
    rationale       non-issues: why it is NOT a finding (optional on gaps)

Scenario ids are unique across the file too.

Each scenario must contain at least one gap (the actual failure) and at least one non-issue (a red
herring a reviewer may plausibly flag but should not). Every location_hint path must exist under
the clean dir, so the key can't drift away from the code the reviewer actually sees.
Exit 0 valid, 1 invalid (every problem is listed), 2 usage.
"""
import json
import os
import re
import sys

CATEGORIES = {"ngrh_real"}
TYPES = {"gap", "non-issue"}
GAP_SEVERITIES = {"high", "medium", "low"}
RAF = {"single_point_of_failure", "excessive_load", "excessive_latency", "misconfiguration_and_bugs", "shared_fate"}
REL = {f"REL-{i:02d}" for i in range(1, 14)}
FINDING_KEYS = {"finding_id", "type", "severity", "raf_category", "rel_category", "location_hint",
                "description", "rationale", "expected_recommendation"}


def hint_paths(hint):
    # "src/clean/app/x.rs (fn) + src/clean/cdk/y.ts (Z) + z.rs" -> the path before the first
    # space/paren of each part. A bare file name ("z.rs") is shorthand for the previous path's dir.
    prev_dir = None
    for part in hint.split(" + "):
        m = re.match(r"\s*([^\s(]+)", part)
        if not m:
            continue
        p = m.group(1)
        if "/" not in p and prev_dir:
            p = f"{prev_dir}/{p}"
        prev_dir = os.path.dirname(p)
        yield p


def check(path, clean_dir):
    errors, ids, scenario_ids = [], set(), set()
    root = os.getcwd()  # location_hint paths are repo-relative; the task runs at the repo root
    clean_abs = os.path.abspath(clean_dir)
    try:
        lines = open(path).read().splitlines()
    except OSError as e:
        return [f"cannot read {path}: {e}"]
    scenarios = 0
    for n, line in enumerate(lines, 1):
        if not line.strip():
            continue
        where = f"{path}:{n}"
        try:
            sc = json.loads(line)
        except json.JSONDecodeError as e:
            errors.append(f"{where}: not JSON ({e})")
            continue
        scenarios += 1
        for k in ("id", "notes"):
            if not isinstance(sc.get(k), str) or not sc[k].strip():
                errors.append(f"{where}: '{k}' must be a non-empty string")
        if isinstance(sc.get("id"), str) and sc["id"] in scenario_ids:
            errors.append(f"{where}: duplicate scenario id {sc['id']!r}")
        scenario_ids.add(sc.get("id"))
        if sc.get("category") not in CATEGORIES:
            errors.append(f"{where}: category {sc.get('category')!r} not in {sorted(CATEGORIES)}")
        extra = set(sc) - {"id", "category", "notes", "findings"}
        if extra:
            errors.append(f"{where}: unknown keys {sorted(extra)}")
        findings = sc.get("findings")
        if not isinstance(findings, list) or not findings:
            errors.append(f"{where}: 'findings' must be a non-empty list")
            continue
        kinds = set()
        for i, f in enumerate(findings):
            w = f"{where} findings[{i}]"
            if not isinstance(f, dict):
                errors.append(f"{w}: not an object")
                continue
            fid = f.get("finding_id")
            w = f"{where} {fid or f'findings[{i}]'}"
            if not isinstance(fid, str) or not fid:
                errors.append(f"{w}: finding_id required")
            elif fid in ids:
                errors.append(f"{w}: duplicate finding_id")
            ids.add(fid)
            extra = set(f) - FINDING_KEYS
            if extra:
                errors.append(f"{w}: unknown keys {sorted(extra)}")
            t = f.get("type")
            if t not in TYPES:
                errors.append(f"{w}: type {t!r} not in {sorted(TYPES)}")
                continue
            kinds.add(t)
            sev = f.get("severity")
            if t == "gap" and sev not in GAP_SEVERITIES:
                errors.append(f"{w}: a gap's severity must be one of {sorted(GAP_SEVERITIES)}, got {sev!r}")
            if t == "non-issue" and sev != "non-issue":
                errors.append(f"{w}: a non-issue's severity must be 'non-issue', got {sev!r}")
            if f.get("raf_category") not in RAF and not (t == "non-issue" and "raf_category" not in f):
                errors.append(f"{w}: raf_category {f.get('raf_category')!r} not in {sorted(RAF)}")
            if "rel_category" in f or t == "gap":
                if f.get("rel_category") not in REL:
                    errors.append(f"{w}: rel_category {f.get('rel_category')!r} must be REL-01..REL-13")
            required = ("description", "location_hint") + (
                ("expected_recommendation",) if t == "gap" else ("rationale",))
            for k in required:
                if not isinstance(f.get(k), str) or not f[k].strip():
                    errors.append(f"{w}: '{k}' must be a non-empty string")
            for p in hint_paths(f.get("location_hint") or ""):
                ap = os.path.abspath(os.path.join(root, p)) if not os.path.isabs(p) else p
                if not (ap == clean_abs or ap.startswith(clean_abs + os.sep)) and not os.path.isabs(p) and not os.path.exists(ap):
                    # Relative to the clean dir (app/router.rs), as the reviewer sees the tree.
                    ap = os.path.abspath(os.path.join(clean_abs, p))
                if not (ap == clean_abs or ap.startswith(clean_abs + os.sep)):
                    errors.append(f"{w}: location_hint path {p!r} is outside {clean_dir}")
                elif not os.path.exists(ap):
                    errors.append(f"{w}: location_hint path {p!r} does not exist")
        if "gap" not in kinds:
            errors.append(f"{where}: no 'gap' finding — the actual failure must be in the key")
        if "non-issue" not in kinds:
            errors.append(f"{where}: no 'non-issue' finding — add the red herrings a reviewer may flag but shouldn't")
    if scenarios == 0:
        errors.append(f"{path}: no scenarios")
    return errors


def main(argv):
    args = list(argv)
    clean = "src/clean"
    if "--clean-dir" in args:
        i = args.index("--clean-dir")
        clean = args[i + 1]
        del args[i:i + 2]
    if len(args) != 1:
        print(__doc__.strip().splitlines()[2], file=sys.stderr)
        return 2
    errors = check(args[0], clean)
    for e in errors:
        print(f"GROUND-TRUTH: {e}")
    if errors:
        print(f"ground-truth FAILED: {len(errors)} problem(s) in {args[0]}")
        return 1
    print(f"ground-truth passed: {args[0]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
