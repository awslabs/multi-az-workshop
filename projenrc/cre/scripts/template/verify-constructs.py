#!/usr/bin/env python3
"""verify-constructs.py [--write] [--modules a,b,...] [dir]      (default dir: cre-constructs)

The installed construct library (`@cre/constructs`) is a dependency, like a package in
node_modules: it must be byte-identical to what sync-constructs.py installed. This checks every file
against the hash manifest (.cre-manifest) written at install time, and fails (exit 1) on a changed,
added or removed file, so a hand edit can't slip into a project and silently diverge from
cre-demo-template. --write regenerates the manifest (only sync-constructs.py does that).

The manifest is one `<sha256>  ./<path>` line per regular file, sorted by the path's bytes (the
format `find | sort | sha256sum` printed, so manifests written before this script still verify).
Files the OS, editors and tools drop in any directory (.DS_Store, Thumbs.db, *.swp, *.pyc,
__pycache__/, .pytest_cache/) aren't edits: ignored here and never installed.
--modules (the build passes the ones .projenrc.ts lists): the installed modules must be exactly
those, so CI (which has no template clone to install from) fails when a change to constructModules
wasn't followed by `npx projen` on a laptop.
Paths are handled as bytes (os.fsencode), so a file name that isn't UTF-8 (possible on Linux)
hashes and sorts like `find | sort | sha256sum` did, instead of crashing (review 10c E4).
"""
import hashlib
import json
import os
import sys

sys.dont_write_bytecode = True  # never a __pycache__ in the template clone or projenrc/cre
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import crelib  # noqa: E402

# What the copy (crelib.mirror) never installs, plus the manifest itself: one list for both, so a
# pattern added there can't make a file the update never removes fail this check (review 10d G2).
IGNORED = (*crelib.MIRROR_EXCLUDES, ".cre-manifest")


def manifest(root):
    lines = []
    for d, dirs, files in os.walk(root):
        # never descends into links (os.walk default)
        dirs[:] = [x for x in dirs if not crelib._excluded(os.path.relpath(os.path.join(d, x), root), x, IGNORED)]
        for name in files:
            p = os.path.join(d, name)
            if os.path.islink(p) or not os.path.isfile(p):
                continue
            if crelib._excluded(os.path.relpath(p, root).replace(os.sep, "/"), name, IGNORED):
                continue
            rel = b"./" + os.fsencode(os.path.relpath(p, root).replace(os.sep, "/"))
            h = hashlib.sha256()
            with open(p, "rb") as f:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    h.update(chunk)
            lines.append((rel, h.hexdigest().encode() + b"  " + rel))
    return b"".join(line + b"\n" for _, line in sorted(lines))


def main(argv):
    write = bool(argv) and argv[0] == "--write"
    if write:
        argv = argv[1:]
    modules = None
    if len(argv) >= 2 and argv[0] == "--modules":
        modules, argv = [m for m in argv[1].split(",") if m], argv[2:]
    root = argv[0] if argv else "cre-constructs"
    if not os.path.isdir(root):
        print(f"❌ {root} not found: the construct library isn't installed. Run: npx projen update-template", file=sys.stderr)
        return 1
    path = os.path.join(root, ".cre-manifest")
    current = manifest(root)
    if write:
        with open(path, "wb") as f:
            f.write(current)
        return 0
    try:
        with open(path, "rb") as f:
            recorded = f.read()
    except OSError:
        print(f"❌ {path} missing. Reinstall with: npx projen update-template", file=sys.stderr)
        return 1
    if modules is not None:
        try:
            with open(os.path.join(root, "package.json")) as f:
                installed = json.load(f).get("creModules")
        except (OSError, ValueError):
            installed = None
        if installed is not None and sorted(installed) != sorted(modules):
            print(f"❌ {root} has the construct modules {', '.join(installed) or 'none'}, but .projenrc.ts lists "
                  f"{', '.join(modules) or 'none'}. Run npx projen (with the template clone beside the project), "
                  "and commit cre-constructs/.", file=sys.stderr)
            return 1
    if recorded == current:
        print(f"✅ {root} matches its install manifest.")
        return 0
    old, new = set(recorded.splitlines()), set(current.splitlines())
    changed = sorted({line.split(b"  ./", 1)[-1] for line in old ^ new})
    print(f"❌ {root} (@cre/constructs) differs from what cre-demo-template installed:", file=sys.stderr)
    for p in changed:
        print(f"  {p.decode(errors='backslashreplace')}", file=sys.stderr)
    print("   It is a dependency: never edit it here. Make the change in cre-demo-template/constructs,\n"
          "   then run npx projen update-template, which reinstalls it as the template has it (an added\n"
          f"   file is removed too). To discard only tracked edits: git restore -- {root}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
