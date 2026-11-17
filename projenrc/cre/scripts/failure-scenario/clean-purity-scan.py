#!/usr/bin/env python3
"""test:clean-purity — src/clean must read as an ordinary, working system: the review agent sees only
src/clean, so nothing in it may say "failure", "scenario", where the failure came from, or that it is
a recreation. Fails on any tell in file contents or in file/directory names.

What is checked:
  - GENERIC: tells every scenario shares (case-insensitive regexes; GENERIC_CS are case-sensitive,
    for acronyms that are ordinary words in lower case).
  - CRE_FORBIDDEN_TERMS (newline-separated; `forbiddenTerms` in .projenrc.ts): this scenario's own
    names (source system, classes, incident ids, SHAs). Matched as literal text, case-insensitively,
    as a whole word or a whole part of an identifier (Term): `ALF` catches `ALFClient` but not
    `half`. A term with `.` or `(` in it matches exactly that text.
  - Imports: src/clean never imports from src/deploy (the overlay), and never the CRE tooling
    constructs (edge, load generation, failure injection, the CRE dashboard).

Escape hatch: CRE_PURITY_ALLOW (newline-separated; `cleanPurityAllow` in .projenrc.ts), entries
"<path> <pattern>": that GENERIC pattern, exactly as listed below, is allowed in that file (a
repo-relative path or a glob, where * also matches /). For an ordinary word a generic pattern can't
tell from a tell (a real `incident` table, a `benchmark/` dir). It lives outside src/clean, so the
reviewer never sees it. Scenario terms can't be allowed: remove them from forbiddenTerms instead.

Binary files and node_modules, target, __pycache__, .venv, cdk.out and dist are not read.
CLEAN_DIR overrides the directory (default src/clean). Exit 0 clean, 1 tells found.
"""
import fnmatch
import os
import re
import sys

GENERIC = [
    # The project's own nature
    r"\bfailure[ _-]?scenario", r"\bground[ _-]?truth", r"\bred[ _-]?herring", r"\bbenchmark", r"\banswer key",
    r"\bthe (intended|designed|deliberate|planted) (bug|failure|flaw|weakness)",
    r"\b(intentional|deliberate|planted|seeded) (bug|failure|flaw|weakness|defect)",
    # Failure injection and its tooling (all of it belongs in src/deploy)
    r"\binject(ion|ed|or|s)?[ _-]?(failure|fault|error|latency)", r"\bfailure[ _-]?inject", r"\bfault[ _-]?inject",
    r"\berror[ _-]?rate[ _-]?(knob|param)", r"\bERROR_RATE_PARAM\b", r"\bshould_fail\b", r"\bchaos\b", r"\bFisNetworkExperiments\b",
    r"\bFailureInjectionParameter\b", r"\bInjectApi\b", r"\blocust", r"\bLoadGenerator\b",
    # CRE tooling around the system, never part of it
    r"\bCreEdgeStack\b", r"\bCreEdgeOrigin\b", r"\bDistributionSigner\b", r"\bLOCUST_EDGE_ROUTE\b", r"\bCreDashboardStack\b",
    r"\bDemoObservability\b", r"\bDEMO_METRIC_NAMESPACE\b", r"\bdemoName\b", r"\b(resilience|cre)[ _-]?demo",
    # Provenance: where this came from
    r"\bpost[ -]?mortem", r"\b(the|this|that|original|real) incident\b",
    r"\brecreat(e|es|ion|ed|ing)( of)? (the|an|a|this) (incident|outage|failure|bug|event)",
    r"\breproduc(e|tion) of\b", r"\bmodell?ed (on|after)\b", r"\bported (from|verbatim)\b", r"\bfaithful(ly)? (to|reproduc|recreat)",
    r"\bpre-incident\b", r"\bcre-demo-template\b", r"\bfive-nines", r"\bmulti-az-(workshop|observability)\b", r"\breinvent-agents-workshop\b",
    # Editorializing the failure mechanism
    r"\bmetastab", r"\bbimodal\b", r"\bretry storm", r"\bthundering herd", r"\bbrown[ -]?out", r"\bcascad(e|ing) failure",
]
# Case-sensitive: acronyms that are ordinary words (or parts of them) in lower case.
GENERIC_CS = [r"\bFIS\b", r"\bCOE[ -]?[0-9]", r"\bCOE\b"]
# src/clean importing the overlay: a relative path up into deploy/, or src/deploy by name.
IMPORT_DEPLOY = re.compile(r"""(from|import|require\(|include|use).*['"](\.\./)+deploy/|['"][^'"]*src/deploy/""")
SKIP_DIRS = {"node_modules", "target", "__pycache__", ".venv", "cdk.out", "dist"}


def part_boundary(s, i):
    """True when a word, or a part of an identifier, starts or ends between s[i-1] and s[i]: next to
    the text's edge or a non-alphanumeric, at a lower-to-upper (fooBar) or letter-to-digit (v2) change,
    or where an acronym meets a word (ALFClient: between F and C)."""
    if i == 0 or i == len(s) or not s[i - 1].isalnum() or not s[i].isalnum():
        return True
    a, b = s[i - 1], s[i]
    return ((a.islower() and b.isupper()) or a.isdigit() != b.isdigit()
            or (a.isupper() and b.isupper() and i + 1 < len(s) and s[i + 1].islower()))


class Term:
    """A scenario term: its literal text, case-insensitively, as a whole word or a whole part of an
    identifier. `ALF` matches `ALF`, `alf_cache` and `ALFClient`, never `half` or `malformed`; `2015`
    never matches `tbl-02015`. An end that isn't a letter or digit (`.java`) matches as plain text."""

    def __init__(self, text):
        self.rx = re.compile(re.escape(text), re.I)
        self.start = text[:1].isalnum()
        self.end = text[-1:].isalnum()

    def search(self, s):
        return any((not self.start or part_boundary(s, m.start())) and (not self.end or part_boundary(s, m.end()))
                   for m in self.rx.finditer(s))


def lines_of(path):
    """The file's lines, or None for a binary file (a NUL byte, as grep -I decides)."""
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError:
        return None
    if b"\0" in data:
        return None
    # split on \n only, as grep numbers lines: splitlines also breaks at a form feed or U+2028,
    # which shifted every later line number (review 10c E9).
    lines = data.split(b"\n")
    if lines and lines[-1] == b"":
        lines.pop()
    return [ln.decode("utf-8", errors="replace") for ln in lines]


def walk(root):
    """(files to read, every path under root for the name check, relative to root)."""
    files, names = [], []
    for d, dirs, fs in os.walk(root):
        rel_d = os.path.relpath(d, root)
        parts = [] if rel_d == "." else rel_d.split(os.sep)
        # Names: everything but what is under node_modules (as `find -not -path '*/node_modules/*'`),
        # so build output (dist/, target/...) is still name-checked (review 10c E9).
        for x in dirs + fs:
            names.append("/".join(parts + [x]))
        dirs[:] = sorted(x for x in dirs if x != "node_modules")
        # Contents: not under a build or cache directory.
        if not SKIP_DIRS.intersection(parts):
            files += [os.path.join(d, x) for x in sorted(fs) if os.path.isfile(os.path.join(d, x))]
    return files, names


def main():
    root = os.environ.get("CLEAN_DIR") or os.path.join("src", "clean")
    if not os.path.isdir(root):
        print(f"clean-purity: no {root}; nothing to check.")
        return 0
    extra = [t for t in (os.environ.get("CRE_FORBIDDEN_TERMS") or "").split("\n") if t]
    allow = [a.split(" ", 1) for a in (os.environ.get("CRE_PURITY_ALLOW") or "").split("\n") if " " in a]
    files, names = walk(root)
    content = {f: lines_of(f) for f in files}
    content = {f: ls for f, ls in content.items() if ls is not None}

    def allowed(path, pat):
        return any(apat == pat and fnmatch.fnmatchcase(path, glob) for glob, apat in allow)

    failed = False

    def report(what, hits):
        nonlocal failed
        print(f"CLEAN-PURITY: {what}:")
        for h in hits:
            print(f"    {h}")
        failed = True

    def check(label, rx, pat, generic):
        hits = [f"{f}:{i}:{line}" for f, ls in content.items() for i, line in enumerate(ls, 1)
                if rx.search(line) and not (generic and allowed(f, pat))]
        if hits:
            report(f"{label} found in {root}", hits)
        hit_names = [n for n in names if rx.search(n) and not (generic and allowed(os.path.join(root, n), pat))]
        if hit_names:
            report(f"{label} in a file/directory name under {root}", hit_names)

    for pat in GENERIC:
        check(f"'{pat}'", re.compile(pat, re.I), pat, True)
    for pat in GENERIC_CS:
        check(f"'{pat}'", re.compile(pat), pat, True)
    for t in extra:
        check(f"scenario term '{t}'", Term(t), t, False)
    hits = [f"{f}:{i}:{line}" for f, ls in content.items() for i, line in enumerate(ls, 1) if IMPORT_DEPLOY.search(line)]
    if hits:
        report("src/clean imports the overlay (src/deploy); the overlay may import the system, never the reverse", hits)

    if failed:
        print(f"clean-purity FAILED: {root} must read as an ordinary system. Move failure tooling to src/deploy and reword the rest.")
        print("  An ordinary word a generic pattern catches: allow it for that file in .projenrc.ts, cleanPurityAllow: ['<path> <pattern>'].")
        return 1
    print(f"clean-purity passed: {root} is clean ({len(GENERIC) + len(GENERIC_CS)} generic + {len(extra)} scenario terms).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
