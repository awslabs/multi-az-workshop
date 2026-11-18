#!/usr/bin/env python3
"""release.py — a Workshop Studio workshop's release of the commit its deploy just tested.

CI runs it (the `release` task) after every stack of a deploy from main succeeded, on that deploy's
commit. The release is how a publish knows which commit to send: `npx projen publish` sends the
latest release (or the one `--version` names), never main's head.

  1. Already released (a `v<semver>` tag points at this commit: the weekly image patch, a re-run):
     nothing to do.
  2. The next version: projen's `bump` (the same as projen's own release: the latest `v*` tag, the
     conventional commits since it, commit-and-tag-version), which writes dist/releasetag.txt and
     dist/changelog.md. Nothing is committed: the version lives in the tag alone.
  3. The tag and the release at this commit, with that changelog: GitHub through `gh` with the job's
     token (contents: write); GitLab through the Releases API with the job's own CI_JOB_TOKEN (it
     may create releases, and the release creates the tag at `ref`).

Exit 0 released (or already) | 10 refused (not in CI) | 20 failed. Last stdout line `RESULT code=<n> step=release`.
"""
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from crelib import RELEASE_TAG, release_tags  # noqa: E402

OK, REFUSED, FAILED = 0, 10, 20
TIMEOUT = 60


class Stop(Exception):
    def __init__(self, msg, code=FAILED):
        super().__init__(msg)
        self.code = code


def say(msg):
    print(msg, file=sys.stderr, flush=True)


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True)


def create_github(tag, sha, notes):
    repo = os.environ["GITHUB_REPOSITORY"]
    r = subprocess.run(["gh", "release", "create", tag, "--repo", repo, "--target", sha, "--title", tag, "--notes-file", notes],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise Stop(f"gh release create {tag} failed: {r.stderr.strip()[-400:]}")


def create_gitlab(tag, sha, notes):
    url = f"{os.environ['CI_API_V4_URL']}/projects/{os.environ['CI_PROJECT_ID']}/releases"
    with open(notes) as f:
        body = json.dumps({"tag_name": tag, "ref": sha, "name": tag, "description": f.read()}).encode()
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"JOB-TOKEN": os.environ["CI_JOB_TOKEN"], "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT):  # noqa: S310 (the instance's own https API)
            pass
    except urllib.error.HTTPError as e:
        raise Stop(f"GitLab refused the release {tag} ({e.code}): {e.read().decode(errors='replace')[:400]}")
    except (urllib.error.URLError, OSError) as e:
        raise Stop(f"GitLab didn't answer the release {tag}: {e}")


def release():
    # Every tag: the next version continues from the latest one (a CI clone may have none fetched).
    git("fetch", "-q", "--tags", "--force", "origin")
    sha = git("rev-parse", "HEAD").stdout.strip()
    done = release_tags(sha)
    if done:
        say(f"✓  {sha[:9]} is released already as {done[0]}: nothing to do.")
        return
    r = subprocess.run(["npx", "projen", "bump"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    say(r.stdout.rstrip())
    if r.returncode != 0:
        raise Stop("npx projen bump failed (above).")
    with open(os.path.join("dist", "releasetag.txt")) as f:
        tag = f.read().strip()
    if not RELEASE_TAG.match(tag):
        raise Stop(f"bump made the tag {tag!r}, not v<major>.<minor>.<patch>.")
    notes = os.path.join("dist", "changelog.md")
    if os.environ.get("GITHUB_ACTIONS"):
        create_github(tag, sha, notes)
    elif os.environ.get("GITLAB_CI"):
        create_gitlab(tag, sha, notes)
    else:
        raise Stop("Not in CI: a release is made only by the deploy, of the commit it tested.", REFUSED)
    say(f"✅ Released {tag} at {sha[:9]}: `npx projen publish` sends it.")


def main():
    try:
        release()
        code = OK
    except Stop as e:
        say(f"❌ {e}")
        code = e.code
    print(f"RESULT code={code} step=release")
    return code


if __name__ == "__main__":
    sys.exit(main())
