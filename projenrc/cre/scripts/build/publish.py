#!/usr/bin/env python3
"""publish.py [--local] [--workshop-id <id>] — send this commit's built workshop to Workshop Studio.

  1. The inputs, from one of two sources. CI: this step's environment (`npx projen publish:upload`,
     the only step of the job that gets them), from the repository's secrets (the credentials the user
     pasted, WS_ACCESS_KEY_ID / WS_SECRET_ACCESS_KEY / WS_SESSION_TOKEN; and REMOTE_REPO,
     ASSETS_LOCATION, GIT_PLUGIN_LOCATION, GIT_PLUGIN, which setup set). --local: the same names from
     the template's laptop-only cresetup/workshop_studio.py (`publish-env`), which gets the workshop's
     1-hour repository credentials with the builder's Midway session, held in this process's memory
     (never its environment, a file or a log); WORKSHOP_ID from --workshop-id, $WORKSHOP_ID, or the
     repository's variable. Either way they are given only to the commands below.
  2. The publish, the same whatever the source: the S3 assets first (assets/ to ASSETS_LOCATION, so
     Workshop Studio's build finds every one the templates name), then content/, static/,
     contentspec.yaml as the workshop repository's whole `mainline` (but FACILITATOR_GUIDE.md, which
     lives only there: an internal document, kept by every publish), in one commit naming this
     repository and commit.

Only a release is published: the latest (release.py makes one after every deploy from main that
succeeded, on the commit it tested, with that build's content.zip), or the one `--version v<x.y.z>`
names. Nothing is built: `publish.py prepare [--version v]` takes the release's commit (CI checks it
out; a laptop must be on it, never moved, and is told the `git checkout` to run), downloads its
content.zip (GitHub: `gh release download`; GitLab: its generic package, with the job token in CI or
your Midway session and GitLab token on a laptop) and unpacks it as assets/, with the zip itself at
assets/content.zip (the guide's download, `:assetUrl{path=/content.zip}`). `workshop:stage` then
copies the templates into static/, and this script sends assets/ and the guide.
Exit 0 published (or nothing changed) | 10 refused (no such release, not the release's commit, a
release with no content.zip, a placeholder credential, an input missing) | 11 the credentials were
refused or have expired | 20 a step failed.
"""
import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import crelib  # noqa: E402
from crelib import RELEASE_TAG, release_package, release_tags  # noqa: E402

OK, REFUSED, CREDS, FAILED = 0, 10, 11, 20
CREDENTIALS = ("WS_ACCESS_KEY_ID", "WS_SECRET_ACCESS_KEY", "WS_SESSION_TOKEN")
INPUTS = (*CREDENTIALS, "REMOTE_REPO", "ASSETS_LOCATION", "GIT_PLUGIN_LOCATION", "GIT_PLUGIN")
# A laptop's: the template's laptop-only module (copied beside the scripts, never committed).
LOCAL_MODULE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "cresetup", "workshop_studio.py")
TOOLS = os.path.join(".cre", "tools")
# What the workshop repository holds: the guide and Workshop Studio's own files, nothing else.
REPO_PATHS = ("content", "static", "contentspec.yaml")
# What lives only in the workshop repository, never in this one (which may be public), and so is
# kept there by every publish: the facilitator guide, an internal document.
KEPT = ("FACILITATOR_GUIDE.md",)
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
        raise Stop(REFUSED, f"Missing {', '.join(missing)}: setup (/cre-demo-init) stores them for the publish, as the repository's "
                            "secrets on GitHub (Settings > Secrets and variables > Actions) or its CI/CD variables on GitLab. Set a "
                            "missing one there by hand: setup:repo --var stores a value for the deploy jobs, where the publish "
                            "can't read it. The credentials are pasted there from the workshop's Repository credentials in "
                            "Workshop Studio before a CI publish.")
    held = [k for k in CREDENTIALS if inp[k].startswith("PLACEHOLDER")]
    if held:
        raise Stop(REFUSED, f"{', '.join(held)} still hold setup's placeholder: paste the workshop's Repository credentials from "
                            "Workshop Studio into the repository's secrets (they last an hour), or publish from a laptop with --local.")


# The AWS CLI's S3 settings for the upload: the classic transfer client, not the CRT one `auto` picks.
# The CRT client sizes its parallel part uploads for the host's network and fails a slow part with
# AWS_IO_SOCKET_TIMEOUT; over a laptop's uplink the 600 MB of images failed that way every time. The
# classic client retries a slow part.
S3_CONFIG = "[default]\ns3 =\n  preferred_transfer_client = classic\n  max_concurrent_requests = 4\n"


def child_env(inp):
    """The commands' environment: this process's, plus the credentials as the AWS CLI reads them, and
    its S3 settings (S3_CONFIG; no other profile or config file applies)."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("AWS_") or k in ("AWS_CA_BUNDLE",)}
    os.makedirs(TOOLS, exist_ok=True)
    config = os.path.abspath(os.path.join(TOOLS, "aws-config"))
    with open(config, "w") as f:
        f.write(S3_CONFIG)
    env.update(AWS_ACCESS_KEY_ID=inp["WS_ACCESS_KEY_ID"], AWS_SECRET_ACCESS_KEY=inp["WS_SECRET_ACCESS_KEY"],
               AWS_SESSION_TOKEN=inp["WS_SESSION_TOKEN"], AWS_REGION=REGION, AWS_DEFAULT_REGION=REGION, AWS_CONFIG_FILE=config)
    return env


# ---- 2. the publish ------------------------------------------------------------------------------

def release(version):
    """(tag, commit) of the release to publish: `version` (v0.0.33 or 0.0.33), else the latest."""
    git("fetch", "-q", "--tags", "--force", "origin")
    if version:
        tag = version if version.startswith("v") else f"v{version}"
        if not RELEASE_TAG.match(tag):
            raise Stop(REFUSED, f"--version {version!r} isn't a release version (v<major>.<minor>.<patch>).")
        if tag not in release_tags():
            raise Stop(REFUSED, f"No release {tag}: the releases are the v* tags (git tag --list 'v*').")
    else:
        tags = release_tags()
        if not tags:
            raise Stop(REFUSED, "No release yet: a deploy from main that succeeds makes one (the release workflow, or GitLab's deploy:release).")
        tag = tags[0]
    sha = git("rev-parse", f"{tag}^{{commit}}").stdout.strip()
    # Only the deploy's releases, which are of main's commits: a v* tag pushed on a branch isn't one.
    git("fetch", "-q", "origin", "main")
    if git("merge-base", "--is-ancestor", sha, "origin/main").returncode != 0:
        raise Stop(REFUSED, f"{tag} ({sha[:9]}) isn't on origin/main, so it isn't a release the deploy made.")
    return tag, sha


# The release `prepare` chose, for the upload that follows (a release made in between changes nothing).
CHOSEN = os.path.join("dist", "release-tag.txt")


def chosen(version):
    """The version to upload: the one named, else the release `prepare` unpacked."""
    if version or not os.path.isfile(CHOSEN):
        return version
    with open(CHOSEN) as f:
        return f.read().strip()


def released_checkout(version):
    """The release, refused unless the checkout is its commit and clean."""
    tag, sha = release(version)
    # Untracked files too: the guide is copied from the checkout, so a file the commit doesn't have
    # would be published with it (what the build makes is gitignored, so it doesn't count).
    if git("status", "--porcelain").stdout.strip():
        raise Stop(REFUSED, "The checkout has changes or files the commit doesn't (git status): publish from a clean checkout.")
    head = git("rev-parse", "HEAD").stdout.strip()
    if head != sha:
        raise Stop(REFUSED, f"{tag} is {sha[:9]}, but the checkout is {head[:9]}: git checkout --detach {tag}, then publish "
                            f"again (or --version for another release).")
    return tag, sha


CONTENT = os.path.join("dist", "content.zip")
# The download of a release's zip (hundreds of MB).
DOWNLOAD_TIMEOUT = 1800


def download_github(tag):
    repo = ["--repo", os.environ["GITHUB_REPOSITORY"]] if os.environ.get("GITHUB_REPOSITORY") else []
    r = run(["gh", "release", "download", tag, *repo, "--pattern", "content.zip", "--dir", "dist", "--clobber"], quiet=True)
    if r.returncode != 0:
        err = r.stderr.strip()
        if "no assets" in err.lower() or "no asset" in err.lower():
            raise Stop(REFUSED, f"The release {tag} has no content.zip: publish a release the deploy made with one.")
        raise Stop(CREDS if "auth" in err.lower() else FAILED, f"Downloading {tag}'s content.zip failed: {err[-400:]}")


class _DropTokenOnRedirect(urllib.request.HTTPRedirectHandler):
    """GitLab may answer a package download with a redirect to its object storage (a presigned URL):
    followed without the job token, which is GitLab's alone."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None:
            for h in ("Job-token", "JOB-TOKEN"):
                new.headers.pop(h, None)
                new.unredirected_hdrs.pop(h, None)
        return new


NO_TOKEN_REDIRECTS = urllib.request.build_opener(_DropTokenOnRedirect)


def download_gitlab_ci(tag):
    project = os.environ.get("PROJECT_NAME") or os.environ.get("CI_PROJECT_NAME")
    url = f"{os.environ['CI_API_V4_URL']}/projects/{os.environ['CI_PROJECT_ID']}/packages/generic/{release_package(project)}/{tag[1:]}/content.zip"
    req = urllib.request.Request(url, headers={"JOB-TOKEN": os.environ["CI_JOB_TOKEN"]})
    try:
        with NO_TOKEN_REDIRECTS.open(req, timeout=DOWNLOAD_TIMEOUT) as r, open(CONTENT, "wb") as f:
            shutil.copyfileobj(r, f)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise Stop(REFUSED, f"The release {tag} has no content.zip: publish a release the deploy made with one.")
        raise Stop(FAILED, f"Downloading {tag}'s content.zip failed ({e.code}).")
    except (urllib.error.URLError, OSError) as e:
        raise Stop(FAILED, f"Downloading {tag}'s content.zip failed: {e}")


def download_gitlab_local(tag):
    """A laptop: the template's laptop-only module downloads it with your Midway session and GitLab
    token (as the git tasks call GitLab); never imported here, which CI runs."""
    if not os.path.isfile(LOCAL_MODULE):
        raise Stop(REFUSED, f"Downloading from GitLab on a laptop needs the template's laptop-only files ({LOCAL_MODULE}): run npx projen "
                            "with your cre-demo-template clone beside the project.")
    _, path = crelib.git_remote(git("remote", "get-url", "origin").stdout.strip())
    if not path:
        raise Stop(REFUSED, "origin isn't a GitLab project URL: can't find the release's content.zip.")
    r = subprocess.run([sys.executable, LOCAL_MODULE, "download-release", path, release_package(os.environ.get("PROJECT_NAME")),
                        tag[1:], CONTENT], capture_output=True, text=True)
    if r.returncode != 0:
        say(r.stderr.rstrip())
        code = r.returncode if r.returncode in (REFUSED, CREDS) else FAILED
        raise Stop(code, f"The release {tag} has no content.zip." if code == REFUSED else f"Downloading {tag}'s content.zip failed.")


def download(tag):
    os.makedirs("dist", exist_ok=True)
    say(f"→  download {tag}'s content.zip (what its deploy deployed)")
    if os.environ.get("GITHUB_ACTIONS"):
        download_github(tag)
    elif os.environ.get("GITLAB_CI"):
        download_gitlab_ci(tag)
    elif crelib.git_remote(git("remote", "get-url", "origin").stdout.strip())[0] == "github.com":
        download_github(tag)
    else:
        download_gitlab_local(tag)


def unpack():
    """assets/ exactly as the release's build had it, plus the zip itself (the guide's download)."""
    shutil.rmtree("assets", ignore_errors=True)
    try:
        with zipfile.ZipFile(CONTENT) as z:
            z.extractall("assets")
    except zipfile.BadZipFile:
        raise Stop(FAILED, f"{CONTENT} isn't a zip (a broken download?): run it again.")
    shutil.copyfile(CONTENT, os.path.join("assets", "content.zip"))


def prepare(version):
    """The release's commit (CI: checked out; a laptop: checked), its content.zip as assets/."""
    tag, sha = release(version)
    if os.environ.get("CI"):
        if git("checkout", "-q", "--detach", sha).returncode != 0:
            raise Stop(FAILED, f"Checking out {tag} failed.")
        say(f"→  publishing {tag} ({sha[:9]})")
    released_checkout(version)
    download(tag)
    unpack()
    with open(CHOSEN, "w") as f:
        f.write(tag + "\n")


def built():
    missing = [p for p in ("assets", "contentspec.yaml", "content", "static") if not os.path.exists(p)]
    if missing:
        raise Stop(REFUSED, f"{', '.join(missing)} missing: npx projen publish prepares them from the release (publish.py prepare, then workshop:stage).")


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
        pip = os.path.join(venv, "bin", "pip")
        # The plugin alone from its own index (never a same-named package from PyPI: no dependency
        # confusion), then the dependencies it declares from PyPI (its index has only the plugin).
        # --isolated: no pip.conf or PIP_* environment can add another index to either install.
        r = run([pip, "install", "-q", "--isolated", "--no-deps", "--index-url", f"https://{inp['GIT_PLUGIN_LOCATION']}", inp["GIT_PLUGIN"]])
        if r.returncode != 0:
            raise Stop(FAILED, f"Installing the git plugin failed: {r.stderr.strip()[-400:]}")
        reqs = requirements(venv, re.split(r"[=<>!~ ]", inp["GIT_PLUGIN"], maxsplit=1)[0])
        if reqs and run([pip, "install", "-q", "--isolated", *reqs]).returncode != 0:
            raise Stop(FAILED, f"Installing the git plugin's dependencies ({', '.join(reqs)}) failed.")
        with open(marker, "w") as f:
            f.write(inp["GIT_PLUGIN"])
    env["PATH"] = os.path.abspath(os.path.join(venv, "bin")) + os.pathsep + env.get("PATH", "")


def requirements(venv, name):
    """The requirements a package installed in `venv` declares (its METADATA's Requires-Dist), its
    optional extras left out."""
    dist = name.replace("-", "_").lower()
    found = [m for m in glob.glob(os.path.join(venv, "lib", "python*", "site-packages", "*.dist-info", "METADATA"))
             if os.path.basename(os.path.dirname(m)).lower().startswith(dist + "-")]
    if not found:
        return []
    with open(found[0]) as f:
        reqs = [line.split(":", 1)[1].strip() for line in f if line.startswith("Requires-Dist:")]
    return [r for r in reqs if "extra ==" not in r]


def push_content(env, remote, tag, head):
    work = tempfile.mkdtemp(prefix="cre-publish-")
    try:
        repo = os.path.join(work, "repo")
        say("→  clone the workshop repository (mainline)")
        r = git("clone", "-q", "--branch", "mainline", remote, repo, env=env)
        if r.returncode != 0:
            err = r.stderr.strip()
            raise Stop(CREDS if "expired" in err.lower() or "denied" in err.lower() else FAILED, f"Cloning the workshop repository failed: {err[-400:]}")
        # Its whole tree becomes this commit's guide: what this repository doesn't have goes. Its own
        # dotfiles stay (.git, and Workshop Studio's .version), and what lives only there (KEPT).
        for name in os.listdir(repo):
            if not name.startswith(".") and name not in KEPT:
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
        msg = f"Publish {tag} ({head[:12]})\n\nFrom {origin or 'the project repository'}, release {tag} at {head}."
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
    tag, head = released_checkout(chosen(a.version))
    built()
    inp = local_inputs(a.workshop_id) if a.local else ci_inputs()
    check_inputs(inp)
    env = child_env(inp)
    try:
        upload_assets(env, inp["ASSETS_LOCATION"])
        if not inp["REMOTE_REPO"].startswith(("file://", "/")):
            git_plugin(env, inp)
        pushed = push_content(env, inp["REMOTE_REPO"], tag, head)
    finally:
        # Gone with this process anyway; dropped now so nothing later in it can reach them.
        for k in CREDENTIALS:
            inp.pop(k, None)
        for k in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
            env.pop(k, None)
    say(f"✅ Published {tag} ({head[:9]})" + ("" if pushed else " (the repository had it already)") +
        ". Workshop Studio builds it now: check the build on the workshop's page.")
    return OK


def main(argv=None):
    p = argparse.ArgumentParser(prog="publish.py", description="Publish a release's workshop to Workshop Studio ([prepare] first: the release and its content.zip).")
    p.add_argument("--local", action="store_true", help="get the inputs on this laptop (Midway), not from the CI job's secrets")
    p.add_argument("--workshop-id", help="the workshop (default: $WORKSHOP_ID, or the repository's WORKSHOP_ID variable)")
    p.add_argument("--version", default=os.environ.get("RELEASE_VERSION", ""),
                   help="the release to publish, v<x.y.z> (default: $RELEASE_VERSION, else the latest release)")
    argv = list(sys.argv[1:] if argv is None else argv)
    only_prepare = bool(argv) and argv[0] == "prepare"
    a = p.parse_args(argv[1:] if only_prepare else argv)
    try:
        if only_prepare:
            prepare(a.version)
            code = OK
        else:
            code = publish(a)
    except Stop as e:
        say(f"❌ {e}")
        code = e.code
    except Exception as e:  # noqa: BLE001 (an unexpected error is still a RESULT line: failed part way)
        say(f"❌ publish failed: {type(e).__name__}: {e}")
        code = FAILED
    print(f"RESULT code={code} step={'publish:prepare' if only_prepare else 'publish'}")
    return code


if __name__ == "__main__":
    sys.exit(main())
