#!/usr/bin/env python3
"""publish.py [--local] [--workshop-id <id>] — send this commit's built workshop to Workshop Studio.

  1. The inputs, from one of two sources. CI: the job's environment, from the repository's secrets
     (the credentials the user pasted, WS_ACCESS_KEY_ID / WS_SECRET_ACCESS_KEY / WS_SESSION_TOKEN; and
     REMOTE_REPO, ASSETS_LOCATION, GIT_PLUGIN_LOCATION, GIT_PLUGIN, which setup set). --local: the same
     names from the template's laptop-only cresetup/workshop_studio.py (`publish-env`), which gets the
     workshop's 1-hour repository credentials with the builder's Midway session; WORKSHOP_ID from
     --workshop-id, $WORKSHOP_ID, or the repository's variable. They are held in this process's memory
     and given only to the commands below (never this process's environment, a file or a log), so
     they are gone when it ends.
  2. The publish, the same whatever the source: the S3 assets first (assets/ to ASSETS_LOCATION, so
     Workshop Studio's build finds every one the templates name), then content/, static/,
     contentspec.yaml (and FACILITATOR_GUIDE.md) as the workshop repository's whole `mainline`, in one
     commit naming this repository and commit.

Only a tested commit is published: the working tree clean, and HEAD on origin's main (a merge to main
built and deployed it). `npx projen publish` builds first, so static/ and assets/ are this commit's.
Exit 0 published (or nothing changed) | 10 refused (not a tested commit, a placeholder credential, an
input missing) | 11 the credentials were refused or have expired | 20 a step failed.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True

OK, REFUSED, CREDS, FAILED = 0, 10, 11, 20
CREDENTIALS = ("WS_ACCESS_KEY_ID", "WS_SECRET_ACCESS_KEY", "WS_SESSION_TOKEN")
INPUTS = (*CREDENTIALS, "REMOTE_REPO", "ASSETS_LOCATION", "GIT_PLUGIN_LOCATION", "GIT_PLUGIN")
# A laptop's: the template's laptop-only module (copied beside the scripts, never committed).
LOCAL_MODULE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "cresetup", "workshop_studio.py")
TOOLS = os.path.join(".cre", "tools")
# What the workshop repository holds: the guide and Workshop Studio's own files, nothing else.
REPO_PATHS = ("content", "static", "contentspec.yaml", "FACILITATOR_GUIDE.md")
REGION = "us-east-1"


class Stop(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code


def say(msg):
    print(msg, file=sys.stderr, flush=True)


def run(cmd, env=None, cwd=None, quiet=False):
    r = subprocess.run(cmd, env=env, cwd=cwd, capture_output=True, text=True)
    if not quiet and r.stdout.strip():
        say(r.stdout.rstrip())
    return r


def git(*args, cwd=None, env=None):
    return run(["git", *args], env=env, cwd=cwd, quiet=True)


# ---- 1. the inputs -------------------------------------------------------------------------------

def workshop_id(given):
    """The workshop: --workshop-id, $WORKSHOP_ID, else the repository's WORKSHOP_ID variable (GitHub: gh)."""
    wid = (given or os.environ.get("WORKSHOP_ID", "")).strip()
    if not wid and shutil.which("gh"):
        r = run(["gh", "variable", "get", "WORKSHOP_ID"], quiet=True)
        wid = r.stdout.strip() if r.returncode == 0 else ""
    if not wid:
        raise Stop(REFUSED, "No workshop id: pass --workshop-id <id> (the WORKSHOP_ID variable setup set, or the workshop's page in "
                            "Workshop Studio).")
    return wid


def local_inputs(given_id):
    if not os.path.isfile(LOCAL_MODULE):
        raise Stop(REFUSED, f"--local needs the template's laptop-only files ({LOCAL_MODULE}): run npx projen with your "
                            "cre-demo-template clone beside the project.")
    # The credentials come back through a pipe, into memory.
    r = subprocess.run([sys.executable, LOCAL_MODULE, "publish-env", workshop_id(given_id)], capture_output=True, text=True)
    if r.returncode != 0:
        say(r.stderr.rstrip())
        raise Stop(r.returncode if r.returncode in (REFUSED, CREDS) else FAILED, "Getting the workshop's repository credentials failed.")
    return json.loads(r.stdout)


def ci_inputs():
    return {k: os.environ.get(k, "") for k in INPUTS}


def check_inputs(inp):
    missing = [k for k in INPUTS if not inp.get(k, "").strip()]
    if missing:
        raise Stop(REFUSED, f"Missing {', '.join(missing)}: setup sets them (npx projen setup:repo), and the credentials are pasted "
                            "from the workshop's Repository credentials in Workshop Studio before a CI publish.")
    held = [k for k in CREDENTIALS if inp[k].startswith("PLACEHOLDER")]
    if held:
        raise Stop(REFUSED, f"{', '.join(held)} still hold setup's placeholder: paste the workshop's Repository credentials from "
                            "Workshop Studio into the repository's secrets (they last an hour), or publish from a laptop with --local.")


def child_env(inp):
    """The commands' environment: this process's, plus the credentials as the AWS CLI reads them."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("AWS_") or k in ("AWS_CA_BUNDLE",)}
    env.update(AWS_ACCESS_KEY_ID=inp["WS_ACCESS_KEY_ID"], AWS_SECRET_ACCESS_KEY=inp["WS_SECRET_ACCESS_KEY"],
               AWS_SESSION_TOKEN=inp["WS_SESSION_TOKEN"], AWS_REGION=REGION, AWS_DEFAULT_REGION=REGION)
    return env


# ---- 2. the publish ------------------------------------------------------------------------------

def tested_commit():
    """HEAD, refused unless the tree is clean and origin's main has it."""
    if git("status", "--porcelain", "--untracked-files=no").stdout.strip():
        raise Stop(REFUSED, "The working tree has uncommitted changes: publish a commit that main has, from a clean checkout.")
    git("fetch", "-q", "origin", "main")
    head = git("rev-parse", "HEAD").stdout.strip()
    if git("merge-base", "--is-ancestor", head, "origin/main").returncode != 0:
        raise Stop(REFUSED, f"{head[:9]} isn't on origin/main: only a merged (built and deployed) commit is published.")
    return head


def built():
    missing = [p for p in ("assets", "contentspec.yaml", "content", "static") if not os.path.exists(p)]
    if missing:
        raise Stop(REFUSED, f"{', '.join(missing)} missing: run npx projen build first (npx projen publish does).")


def upload_assets(env, location):
    say(f"→  upload the S3 assets (assets/) to the workshop's assets location")
    r = run(["aws", "s3", "sync", "assets", location, "--delete", "--no-progress", "--only-show-errors"], env=env)
    if r.returncode != 0:
        err = r.stderr.strip()
        code = CREDS if any(x in err for x in ("ExpiredToken", "InvalidAccessKeyId", "SignatureDoesNotMatch", "AccessDenied")) else FAILED
        raise Stop(code, f"The asset upload failed: {err[-400:]}" + (" (the credentials expired or were refused: get fresh ones)" if code == CREDS else ""))


def git_plugin(env, inp):
    """The git plugin, in its own virtualenv under .cre/tools; its helper on the commands' PATH."""
    venv = os.path.join(TOOLS, "git-plugin")
    marker = os.path.join(venv, "installed.txt")
    if not (os.path.isfile(marker) and open(marker).read() == inp["GIT_PLUGIN"]):
        say("→  install the git plugin")
        shutil.rmtree(venv, ignore_errors=True)
        if run([sys.executable, "-m", "venv", venv]).returncode != 0:
            raise Stop(FAILED, "Making the git plugin's virtualenv failed (python3 -m venv).")
        pip, py = os.path.join(venv, "bin", "pip"), os.path.join(venv, "bin", "python")
        host = inp["GIT_PLUGIN_LOCATION"]
        # The plugin alone from its own index (never a same-named package from PyPI: no dependency
        # confusion), then the dependencies it declares from PyPI (its index has only the plugin).
        r = run([pip, "install", "-q", "--no-deps", "--trusted-host", host, "--index-url", f"https://{host}", inp["GIT_PLUGIN"]])
        if r.returncode != 0:
            raise Stop(FAILED, f"Installing the git plugin failed: {r.stderr.strip()[-400:]}")
        name = re.split(r"[=<>!~ ]", inp["GIT_PLUGIN"], maxsplit=1)[0]
        reqs = [x for x in run([py, "-c", "import importlib.metadata as m, sys; print('\\n'.join(r for r in (m.requires(sys.argv[1]) or []) "
                                         "if 'extra ==' not in r))", name], quiet=True).stdout.splitlines() if x.strip()]
        if reqs and run([pip, "install", "-q", *reqs]).returncode != 0:
            raise Stop(FAILED, f"Installing the git plugin's dependencies ({', '.join(reqs)}) failed.")
        with open(marker, "w") as f:
            f.write(inp["GIT_PLUGIN"])
    env["PATH"] = os.path.abspath(os.path.join(venv, "bin")) + os.pathsep + env.get("PATH", "")


def push_content(env, remote, head):
    work = tempfile.mkdtemp(prefix="cre-publish-")
    try:
        repo = os.path.join(work, "repo")
        say("→  clone the workshop repository (mainline)")
        r = git("clone", "-q", "--branch", "mainline", remote, repo, env=env)
        if r.returncode != 0:
            err = r.stderr.strip()
            raise Stop(CREDS if "expired" in err.lower() or "denied" in err.lower() else FAILED, f"Cloning the workshop repository failed: {err[-400:]}")
        # Its whole tree becomes this commit's guide: what this repository doesn't have goes. Its own
        # dotfiles stay (.git, and Workshop Studio's .version).
        for name in os.listdir(repo):
            if not name.startswith("."):
                p = os.path.join(repo, name)
                shutil.rmtree(p) if os.path.isdir(p) and not os.path.islink(p) else os.remove(p)
        for p in REPO_PATHS:
            if os.path.isdir(p):
                shutil.copytree(p, os.path.join(repo, p))
            elif os.path.isfile(p):
                shutil.copyfile(p, os.path.join(repo, p))
        git("add", "-A", cwd=repo)
        if not git("status", "--porcelain", cwd=repo).stdout.strip():
            say("✓  the workshop repository already has this content: nothing to push")
            return False
        origin = git("remote", "get-url", "origin").stdout.strip()
        name = git("config", "user.name").stdout.strip() or os.environ.get("GITHUB_ACTOR") or os.environ.get("GITLAB_USER_LOGIN") or "cre-publish"
        email = git("config", "user.email").stdout.strip() or os.environ.get("GITLAB_USER_EMAIL") or f"{name}@users.noreply.github.com"
        msg = f"Publish {head[:12]}\n\nFrom {origin or 'the project repository'} at {head}."
        if git("-c", f"user.name={name}", "-c", f"user.email={email}", "commit", "-q", "-m", msg, cwd=repo, env=env).returncode != 0:
            raise Stop(FAILED, "Committing to the workshop repository failed.")
        say("→  push to the workshop repository (mainline)")
        r = git("push", "-q", "origin", "mainline", cwd=repo, env=env)
        if r.returncode != 0:
            raise Stop(FAILED, f"Pushing to the workshop repository failed: {r.stderr.strip()[-400:]}")
        return True
    finally:
        shutil.rmtree(work, ignore_errors=True)


def publish(a):
    head = tested_commit()
    built()
    inp = local_inputs(a.workshop_id) if a.local else ci_inputs()
    check_inputs(inp)
    env = child_env(inp)
    try:
        upload_assets(env, inp["ASSETS_LOCATION"])
        if not inp["REMOTE_REPO"].startswith(("file://", "/")):
            git_plugin(env, inp)
        pushed = push_content(env, inp["REMOTE_REPO"], head)
    finally:
        # Gone with this process anyway; dropped now so nothing later in it can reach them.
        for k in CREDENTIALS:
            inp.pop(k, None)
        for k in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
            env.pop(k, None)
    say(f"✅ Published {head[:9]}" + ("" if pushed else " (the repository had it already)") +
        ". Workshop Studio builds it now: check the build on the workshop's page.")
    return OK


def main(argv=None):
    p = argparse.ArgumentParser(prog="publish.py", description="Publish this commit's built workshop to Workshop Studio.")
    p.add_argument("--local", action="store_true", help="get the inputs on this laptop (Midway), not from the CI job's secrets")
    p.add_argument("--workshop-id", help="the workshop (default: $WORKSHOP_ID, or the repository's WORKSHOP_ID variable)")
    a = p.parse_args(argv)
    try:
        code = publish(a)
    except Stop as e:
        say(f"❌ {e}")
        code = e.code
    print(f"RESULT code={code} step=publish")
    return code


if __name__ == "__main__":
    sys.exit(main())
