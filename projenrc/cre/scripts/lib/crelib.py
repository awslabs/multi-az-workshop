"""Helpers the CRE project's own scripts share: the git tasks (scripts/git), the build and deploy
scripts (scripts/build), the template scripts (scripts/template) and CloudFront Signer (scripts/cfs).
Python 3.9+, standard library only. The setup the template runs is scripts/cresetup, which has its
own small modules; this file was the old setup's library, trimmed to what these scripts use.

  - Printers (ok, info, warn, say) and Step, which ends a script with its exit code and a last
    stdout line `RESULT code=<n> step=<name>`; cli(name, main) is each entry point's wrapper.
  - run, stream, git: one subprocess. What only a laptop runs (the Midway cookie, curl, CloudFront
    Signer, the GitLab client) is crelocal.py: CI's scripts import this file, never that one.
  - The stack plan reader (plan_doc, read_plan), the partition tables, the template copy (mirror,
    drop_template_only, project_template_dir). The production check is setup's alone
    (cresetup/prod.py): setup:aws and unbootstrap use it.
  - Exit codes: 0 done; 10 refused (nothing changed); 11 credentials; 20 failed part way.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time

LIB_DIR = os.path.dirname(os.path.abspath(__file__))

# The pieces setup and these scripts share live in cresetup/ (one copy each): the subprocess runner
# (proc), the aws CLI runner (aws), the CloudFormation stack state (cfn), the names (constants).
# Appended, never first, so a module
# in cresetup/ never shadows one the caller's own directory has.
sys.path.append(os.path.join(os.path.dirname(LIB_DIR), "cresetup"))
import proc  # noqa: E402
from result import CREDS as CREDENTIALS, FAILED, OK, REFUSED  # noqa: E402,F401  (the setup contract's codes: one copy)
from proc import last_line  # noqa: E402,F401  (the last non-blank line of a command's output)
from aws import lapsed as credentials_lapsed  # noqa: E402,F401  (AWS refused the credentials: one test)


# ---- the step: messages, outputs, exit ---------------------------------------------------------

class Exit(Exception):
    """Ends a step with an exit code (the message is already printed)."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


# ---- messages (stderr) -----------------------------------------------------------------------------
# The one set of printers every script uses (review 10c G5), so a severity looks the same whichever
# script printed it. Flushed: under an agent's shell tool stderr is a pipe (block-buffered), and a
# message such as "ACTION NEEDED in the browser" must show while the step waits, not when it ends.

# A cli() entry point's messages carry the wall-clock time and the seconds since the run started
# (`[18:48:26 +12.3s] ✅ ...`), so a log shows where a run spent its time. The git tasks, which
# share these printers, stay unstamped. stderr only: the KEY=value and RESULT lines on stdout are
# never stamped.
_STAMP = {"t0": None}


def stamp_messages():
    if _STAMP["t0"] is None:
        _STAMP["t0"] = time.time()


def elapsed():
    """Seconds since stamp_messages() (0 when the messages aren't stamped)."""
    return time.time() - _STAMP["t0"] if _STAMP["t0"] is not None else 0.0


def _emit(mark, msg):
    head = f"[{time.strftime('%H:%M:%S')} +{elapsed():.1f}s] " if _STAMP["t0"] is not None else ""
    print(f"{head}{mark}{msg}", file=sys.stderr, flush=True)


def info(msg):
    _emit("ℹ️  ", msg)


def ok(msg):
    _emit("✅ ", msg)


def warn(msg):
    _emit("⚠️  ", msg)


def plan(msg):
    _emit("→  ", msg)


def say(msg):
    """A plain line on stderr (a heading, a quoted log), no severity mark."""
    _emit("", msg)


class Step:
    """One script's run: its messages, its KEY=value outputs and the exit code it ends with.

    echo=True (a script run from the command line) prints each output on stdout as it is made;
    echo=False (a caller that only needs the printers and die(), such as GitLab) keeps them in
    `outputs`.
    """

    def __init__(self, name, echo=True):
        self.name = name
        self.echo = echo
        self.outputs = {}

    # messages (stderr): crelib's one set of printers (below)
    def info(self, msg):
        info(msg)

    def ok(self, msg):
        ok(msg)

    def warn(self, msg):
        warn(msg)

    def plan(self, msg):
        plan(msg)

    def out(self, key, value):
        value = "" if value is None else str(value)
        # The first value of a key is the one callers read; a step never sets a key twice on purpose.
        self.outputs.setdefault(key, value)
        if self.echo:
            print(f"{key}={value}", flush=True)


    def die(self, code, msg):
        _emit("❌ ", msg)
        raise Exit(code)



def invoke(name, fn, argv, echo=True):
    """Run a step function fn(step, argv) and return (code, step)."""
    step = Step(name, echo=echo)
    try:
        fn(step, argv)
        code = OK
    except Exit as e:
        code = e.code
    except KeyboardInterrupt:
        print("❌ Interrupted.", file=sys.stderr)
        code = FAILED
    except Exception:  # a bug or an unexpected environment: still an exit code and a RESULT line
        import traceback
        traceback.print_exc()
        _emit("❌ ", f"{name} failed unexpectedly (the traceback above). Re-run; if it repeats, report it.")
        code = FAILED
    return code, step


def cli(name, fn):
    """The command-line entry point of a step: prints the RESULT line and exits with its code."""
    stamp_messages()
    code, _ = invoke(name, fn, sys.argv[1:], echo=True)
    info(f"{name} ended (exit {code}) after {elapsed():.1f}s.")
    print(f"RESULT code={code} step={name}", flush=True)
    sys.exit(code)


class _HelpFormatter(argparse.HelpFormatter):
    """Wraps help text at spaces only: argparse's default breaks at hyphens, which split a switch
    named in the text (`--exec-` / `role`)."""

    def _split_lines(self, text, width):
        import textwrap
        return textwrap.wrap(self._whitespace_matcher.sub(" ", text).strip(), width, break_on_hyphens=False)


class Parser(argparse.ArgumentParser):
    """argparse that refuses bad input with exit 10 (refused), not argparse's 2."""

    def __init__(self, step, prog, **kw):
        kw.setdefault("formatter_class", _HelpFormatter)
        super().__init__(prog=prog, allow_abbrev=False, **kw)
        self._step = step

    def error(self, message):
        self._step.die(REFUSED, f"{self.prog}: {message}")


class ExitParser(argparse.ArgumentParser):
    """argparse for a script outside cli(): a usage error prints the usage and `❌ <prog>: <why>`,
    then the script's own RESULT line (`result`: the fields after code=, when it has one) and exits
    `code` (the setup contract's 10 by default), never argparse's bare 2 (review 10c D5, 10d B13).
    The one copy for stacks, watch, ci:rerun and the local deploy."""

    def __init__(self, *args, result=None, code=REFUSED, **kw):
        kw.setdefault("formatter_class", _HelpFormatter)
        super().__init__(*args, **kw)
        self.result, self.code = result, code

    def error(self, message):
        self.print_usage(sys.stderr)
        _emit("❌ ", f"{self.prog}: {message}")
        if self.result is not None:
            print(f"RESULT code={self.code} {self.result}", flush=True)
        sys.exit(self.code)


# ---- processes -----------------------------------------------------------------------------------

def run(cmd, *, input=None, cwd=None, env=None):
    """proc.run (setup's runner: stdin closed unless `input` is given, so a child can never wait on
    a prompt nobody sees; undecodable bytes replaced; a missing executable is 127), with no time
    limit and `env` added to this process's. Returns a CompletedProcess; never raises on exit code."""
    r = proc.run(cmd, None, env={**os.environ, **env} if env else None, cwd=cwd, input=input)
    return subprocess.CompletedProcess(cmd, r.code, r.out, r.err)


def account_of(arn):
    """The account an ARN names ("" when it isn't an ARN)."""
    parts = arn.split(":")
    return parts[4] if len(parts) > 4 else ""


def stream(cmd, *, cwd=None, env=None, log=None):
    """Run a command with its output shown as it happens (log: appended to that file instead);
    returns the exit code, 127 when the executable is missing. For long commands (a build, a
    deploy wait) whose progress a person or agent should see; `run` captures instead."""
    full_env = {**os.environ, **env} if env else None
    sys.stdout.flush()
    sys.stderr.flush()
    try:
        if log:
            with open(log, "a") as f:
                return subprocess.run(cmd, cwd=cwd, env=full_env, stdout=f, stderr=subprocess.STDOUT).returncode
        return subprocess.run(cmd, cwd=cwd, env=full_env).returncode
    except FileNotFoundError:
        print(f"{cmd[0]}: command not found", file=sys.stderr)
        return 127


def exec_replace(cmd, env=None):
    """Replace this process with cmd (the command's signals and exit code become this process's).
    env: the complete environment (os.environ when None). Exits 127 when cmd isn't found."""
    sys.stdout.flush()
    sys.stderr.flush()
    try:
        os.execvpe(cmd[0], cmd, os.environ if env is None else env)
    except FileNotFoundError:
        print(f"{cmd[0]}: command not found", file=sys.stderr)
        sys.exit(127)


# Never copied, and never deleted from the destination, by mirror(): local tooling state.
MIRROR_EXCLUDES = ("__pycache__", ".pytest_cache", "*.pyc", ".DS_Store", "Thumbs.db", "*.swp")
# Scripts only the template runs (under the package's scripts/): never vended into a project, and
# removed from one that has an old copy, so no agent takes them for project tools (review 10d G7).
# update-template.sh is the shim an old project's vendored copy runs FROM THE TEMPLATE CLONE; a
# project never runs its own (review 10g G6).
# cresetup/scaffold.py, clone.py and build.py make or adopt a project from the template clone (the
# scaffold needs its skeleton/); the rest of cresetup/ is what a project's setup tasks run.
TEMPLATE_ONLY_SCRIPTS = ("template/update-template.sh",
                        "cresetup/scaffold.py", "cresetup/clone.py", "cresetup/build.py",
                        "cresetup/setup_project.py",
                        "cresetup/tool_check.py", "cresetup/project_name.py")


def drop_template_only(scripts_dir):
    """Remove TEMPLATE_ONLY_SCRIPTS from a project's copy of the package's scripts/."""
    for rel in TEMPLATE_ONLY_SCRIPTS:
        p = os.path.join(scripts_dir, *rel.split("/"))
        if os.path.isdir(p) and not os.path.islink(p):
            shutil.rmtree(p)
        elif os.path.lexists(p):
            os.remove(p)


def _excluded(rel, name, patterns):
    """A pattern is a name glob matched at any depth, or `/name` anchored at the top."""
    import fnmatch
    for p in patterns:
        if p.startswith("/"):
            if rel == p[1:]:
                return True
        elif fnmatch.fnmatchcase(name, p):
            return True
    return False


def git_ignored(root):
    """Paths under <root> (relative to it) that git ignores there and that aren't tracked: files,
    and whole ignored directories. Empty outside a git work tree."""
    if not os.path.isdir(root):
        return set()
    r = git("-C", root, "ls-files", "-z", "-o", "-i", "--exclude-standard", "--directory")
    return {x.rstrip("/") for x in r.stdout.split("\0") if x} if r.returncode == 0 else set()


def mirror(src, dest, exclude=MIRROR_EXCLUDES, skip_ignored=False):
    """Make <dest> a copy of <src> (what `rsync -a --delete` did, without needing rsync; review 10c
    G7): every file copied with its mode and times, symlinks kept as links, and anything in <dest>
    that <src> doesn't have removed. An excluded path is neither copied nor removed. skip_ignored:
    a file git ignores in <src>'s repository isn't copied (local scratch, a build's output), and
    scratch git ignores in <dest>'s isn't removed (review 10g B12): what <src>'s repository would
    ignore there too (a __pycache__). A file <dest> ignores only because it is local-only there (a
    laptop script the template has since removed) is removed like any other. Returns the number of
    files copied."""
    copied = 0
    os.makedirs(dest, exist_ok=True)
    src_ignored = git_ignored(src) if skip_ignored else set()
    dest_ignored = git_ignored(dest) if skip_ignored else set()
    if dest_ignored:
        # Kept only when the template's repository ignores that path as well: its scratch, not its files.
        r = subprocess.run(["git", "-C", src, "check-ignore", "--no-index", "--stdin", "-z"],
                           input="\0".join(sorted(dest_ignored)) + "\0", capture_output=True, text=True)
        dest_ignored = {x.rstrip("/") for x in r.stdout.split("\0") if x} if r.returncode in (0, 1) else dest_ignored

    def remove(path):
        if os.path.isdir(path) and not os.path.islink(path):
            shutil.rmtree(path)
        else:
            os.remove(path)

    def walk(rel):
        nonlocal copied
        s_dir, d_dir = os.path.join(src, rel), os.path.join(dest, rel)
        names = sorted(os.listdir(s_dir))
        keep = set()
        for name in names:
            r = os.path.join(rel, name) if rel else name
            if _excluded(r, name, exclude) or r in src_ignored:
                continue
            keep.add(name)
            s, d = os.path.join(s_dir, name), os.path.join(d_dir, name)
            if os.path.islink(s):
                if os.path.lexists(d):
                    remove(d)
                os.symlink(os.readlink(s), d)
            elif os.path.isdir(s):
                if os.path.lexists(d) and (os.path.islink(d) or not os.path.isdir(d)):
                    remove(d)
                os.makedirs(d, exist_ok=True)
                walk(r)
                shutil.copystat(s, d)
            else:
                if os.path.lexists(d) and (os.path.islink(d) or os.path.isdir(d)):
                    remove(d)
                shutil.copy2(s, d)
                copied += 1
        for name in os.listdir(d_dir):
            r = os.path.join(rel, name) if rel else name
            if name not in keep and not _excluded(r, name, exclude) and r not in dest_ignored:
                remove(os.path.join(d_dir, name))

    walk("")
    return copied


def write_json(path, doc, sort_keys=True):
    with open(path, "w") as f:
        json.dump(doc, f, indent=2, sort_keys=sort_keys)
        f.write("\n")


# ---- AWS -----------------------------------------------------------------------------------------

# The one reader of cre-stacks.json (cresetup/stack_plan.py): setup reads it too.
from stack_plan import BadFile, plan_doc, read_plan  # noqa: E402,F401


def output_vars(outputs, prefix, stack, only=None):
    """A stack's CloudFormation outputs as the variables its job writes for later stacks:
    `<prefix>_<OUTPUTKEY>=value`, only the `only` ones when given. A value with a line break can't go
    through a one-line-per-variable file: refused, naming it. The one copy of this rule for CI
    (deploy-stack.py) and the local deploy, which turned the newline into a space (review 10f D4).
    Returns [(key, value)]; raises ValueError with the message."""
    kept = [o for o in outputs or [] if only is None or o["OutputKey"] in only]
    multi = [o["OutputKey"] for o in kept if "\n" in o["OutputValue"] or "\r" in o["OutputValue"]]
    if multi:
        raise ValueError(f"Output(s) {', '.join(multi)} of {stack} contain a line break, which the outputs file (one "
                         "KEY=value line each) can't carry to the next stack. Change the output's value (e.g. join the lines, "
                         "or encode it).")
    return [((prefix + "_" if prefix else "") + o["OutputKey"].upper(), o["OutputValue"]) for o in kept]


# ---- shared names -------------------------------------------------------------------------------

from git_state import operation as git_operation  # noqa: E402
from parallel import parallel  # noqa: E402,F401  (independent AWS waits at once)
# The shared names and settings (cresetup/constants.py; the same tables as stack-plan.ts, a jest test
# keeps them equal), and how the AWS CLI says the credentials lapsed.
from constants import CREDENTIALS_LAPSED, DNS_CONTROL_PLANE, IAM_CONTROL_PLANE  # noqa: E402,F401


def partition_of(region):
    """The partition a region name belongs to (as stack-plan.ts partitionOf)."""
    for prefix, partition in (("cn-", "aws-cn"), ("us-gov-", "aws-us-gov"), ("eusc-", "aws-eusc")):
        if region.startswith(prefix):
            return partition
    return "aws"


def control_plane_regions(partition):
    """The regions that always need an assets bucket in a partition (IAM, then DNS; one in most)."""
    return list(dict.fromkeys([IAM_CONTROL_PLANE.get(partition, "us-east-1"), DNS_CONTROL_PLANE.get(partition, "us-east-1")]))


def read_json(path):
    """A JSON object file as a dict: {} when it is missing, unreadable or not an object."""
    try:
        with open(path) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def json_str(d, key):
    """d[key] when it is a string, else ""."""
    v = d.get(key, "")
    return v if isinstance(v, str) else ""


def is_template_clone(path):
    return bool(path) and os.path.isdir(os.path.join(path, "packages", "cre-projen", "src"))


def recorded_template(project_root):
    """(the templatePath a project records, its projenrc/cre/SOURCE.json): .cre/template.json (per
    machine) since #35, SOURCE.json's templatePath in older projects."""
    src = read_json(os.path.join(project_root, "projenrc", "cre", "SOURCE.json"))
    rec = json_str(read_json(os.path.join(project_root, ".cre", "template.json")), "templatePath") or json_str(src, "templatePath")
    return rec, src


def project_template_dir(project_root):
    """The template clone a project uses, the one way every script finds it (review 10c G6): the
    recorded one, else the sibling directory SOURCE.json names (`templateDirName`, a plain name).
    "" when neither is a clone."""
    rec, src = recorded_template(project_root)
    if is_template_clone(rec):
        return rec
    name = json_str(src, "templateDirName") or "cre-demo-template"
    if "/" in name or name in ("..", "."):
        return ""
    sibling = os.path.join(os.path.dirname(os.path.abspath(project_root)), name)
    return sibling if is_template_clone(sibling) else ""


def template_dir():
    """The cre-demo-template clone: this file's own (run from the template), or the project's
    (`project_template_dir`, run from a project's vendored copy). "" when unknown."""
    # lib → scripts → cre-projen | cre → packages | projenrc → the template | the project
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(LIB_DIR))))
    if os.path.isfile(os.path.join(root, "recipe", "recipe.md")) and os.path.isdir(os.path.join(root, "skeleton")):
        return root
    return project_template_dir(root)


# ---- git ----------------------------------------------------------------------------------------


def is_commit_sha(value):
    """A full commit id (40 lowercase hex): what a project pins (SOURCE.json templateSha) and what
    sync-constructs.py --at takes. Anything else is refused before it reaches git, where a value
    starting with "-" would be read as an option (git archive --remote=..., --output=...)."""
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value) is not None


# A workshop's release tag (release.py makes it; publish sends the latest, or the one named).
RELEASE_TAG = re.compile(r"^v(\d+)\.(\d+)\.(\d+)$")


def release_tags(ref=None, cwd=None):
    """The release tags, newest version first: every one, or those pointing at `ref`."""
    r = git("tag", "--list", "v*", *(["--points-at", ref] if ref else []), cwd=cwd)
    tags = [t for t in r.stdout.split() if RELEASE_TAG.match(t)]
    return sorted(tags, key=lambda t: tuple(int(x) for x in RELEASE_TAG.match(t).groups()), reverse=True)


def git(*args, cwd=None, env=None):
    return run(["git"] + list(args), cwd=cwd, env=env)


def git_remote(url):
    """(host, path) of a git URL: https://host/path, ssh://user@host[:port]/path or user@host:path,
    the path without a trailing .git or /. ("", "") when it is none of them. The one parser of a
    remote's host (by its host, never a substring of the whole URL)."""
    m = (re.match(r"^[a-z+]+://(?:[^@/]+@)?([^/:]+)(?::\d+)?/(.+)$", url or "")
         or re.match(r"^(?:[^@/]+@)?([^/:]+):(?!//)(.+)$", url or ""))
    if not m:
        return "", ""
    path = m.group(2).rstrip("/")
    return m.group(1).lower(), path[:-4] if path.endswith(".git") else path


def provider_of(url):
    """The git host an origin URL is on: github, gitlab or unknown. The one rule (the git tasks'
    provider, attach-template's GitLab token link)."""
    host = git_remote(url)[0]
    return "github" if host == "github.com" else "gitlab" if "gitlab" in host.split(".") else "unknown"


def in_progress_op(cwd=None, run_git=None):
    """The git operation in progress in cwd (am, rebase, merge, cherry-pick, revert, bisect), "" when
    none: cresetup/git_state.py's one list (setup's adoption check uses it too, review 10i C6).
    run_git: the git runner (the git tasks pass theirs, which holds signals)."""
    run_git = run_git or (lambda *args: git(*args, cwd=cwd))
    return git_operation(cwd, lambda names: run_git("rev-parse", *[a for n in names for a in ("--git-path", n)]).stdout.splitlines())


