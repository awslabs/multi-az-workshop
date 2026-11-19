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
  3. The tag and the release at this commit, with that changelog and dist/content.zip (the build
     the deploy deployed, from its CI artifact): GitHub through `gh` with the job's token
     (contents: write), the zip a release asset; GitLab with the job's own CI_JOB_TOKEN, the zip
     uploaded to the project's generic package registry (`<project>/<version>/content.zip`), then
     the release through the Releases API, which creates the tag at `ref` and links the zip.

Exit 0 released (or already) | 10 refused (not in CI, or a commit older than the latest release) | 20 failed. Last stdout line `RESULT code=<n> step=release`.
"""
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from crelib import RELEASE_TAG, release_package, release_tags  # noqa: E402

OK, REFUSED, FAILED = 0, 10, 20
TIMEOUT = 60
# The zip is hundreds of MB: its upload gets longer.
UPLOAD_TIMEOUT = 1800
CONTENT = os.path.join("dist", "content.zip")


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
    r = subprocess.run(["gh", "release", "create", tag, "--repo", repo, "--target", sha, "--title", tag, "--notes-file", notes, CONTENT],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise Stop(f"gh release create {tag} failed: {r.stderr.strip()[-400:]}\n{github_refusal(repo, tag, sha)}")


# What a refusal's answer says beyond its message: which permissions GitHub would have accepted, and
# the ids GitHub support traces it by. `gh release create` prints only the message.
REFUSAL_HEADERS = ("x-accepted-github-permissions", "x-github-request-id", "x-oauth-scopes", "x-github-sso")


def github_refusal(repo, tag, sha):
    """The same create, as a draft (deleted at once if it succeeds), with GitHub's answer headers:
    what to know about a refusal before changing anything."""
    r = subprocess.run(["gh", "api", "-i", "-X", "POST", f"repos/{repo}/releases", "-f", f"tag_name={tag}", "-f", f"target_commitish={sha}",
                        "-F", "draft=true", "-f", f"name={tag} (diagnostic)"], capture_output=True, text=True)
    head = [ln for ln in r.stdout.splitlines() if ln.lower().startswith(("http/",) + REFUSAL_HEADERS)]
    body = r.stdout.split("\r\n\r\n", 1)[-1].split("\n\n", 1)[-1].strip()[:300]
    if r.returncode == 0:
        rid = json.loads(body or "{}").get("id") if body.startswith("{") else None
        if rid:
            subprocess.run(["gh", "api", "-X", "DELETE", f"repos/{repo}/releases/{rid}"], capture_output=True)
        return "The same create as a draft was accepted (and deleted): the refusal was of the asset or the published release."
    return "GitHub's answer to the same create (a draft):\n  " + "\n  ".join(head + ([body] if body else []))


def gitlab_call(what, url, data, content_type, timeout=TIMEOUT):
    """One write to the instance's API with the job's token; a refusal or no answer stops the release."""
    headers = {"JOB-TOKEN": os.environ["CI_JOB_TOKEN"], "Content-Type": content_type}
    if hasattr(data, "read"):
        headers["Content-Length"] = str(os.fstat(data.fileno()).st_size)
    req = urllib.request.Request(url, data=data, method="PUT" if hasattr(data, "read") else "POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout):  # noqa: S310 (the instance's own https API)
            pass
    except urllib.error.HTTPError as e:
        raise Stop(f"GitLab refused {what} ({e.code}): {e.read().decode(errors='replace')[:400]}")
    except (urllib.error.URLError, OSError) as e:
        raise Stop(f"GitLab didn't answer {what}: {e}")


def create_gitlab(tag, sha, notes):
    project = f"{os.environ['CI_API_V4_URL']}/projects/{os.environ['CI_PROJECT_ID']}"
    # The zip first, in the generic package registry (the Releases API links assets, it doesn't hold them).
    package = release_package(os.environ.get("PROJECT_NAME") or os.environ.get("CI_PROJECT_NAME"))
    asset = f"{project}/packages/generic/{package}/{tag[1:]}/content.zip"
    with open(CONTENT, "rb") as f:
        gitlab_call(f"the upload of content.zip for {tag}", asset, f, "application/zip", UPLOAD_TIMEOUT)
    with open(notes) as f:
        body = json.dumps({"tag_name": tag, "ref": sha, "name": tag, "description": f.read(),
                           "assets": {"links": [{"name": "content.zip", "url": asset, "link_type": "package"}]}}).encode()
    gitlab_call(f"the release {tag}", f"{project}/releases", body, "application/json")


def release():
    create = create_github if os.environ.get("GITHUB_ACTIONS") else create_gitlab if os.environ.get("GITLAB_CI") else None
    if create is None:
        raise Stop("Not in CI: a release is made only by the deploy, of the commit it tested.", REFUSED)
    # Every tag: the next version continues from the latest one (a CI clone may have none fetched).
    git("fetch", "-q", "--tags", "--force", "origin")
    sha = git("rev-parse", "HEAD").stdout.strip()
    done = release_tags(sha)
    if done:
        say(f"✓  {sha[:9]} is released already as {done[0]}: nothing to do.")
        return
    # Only a commit after the latest release: an older pipeline's job (a retry, an overlap) would
    # otherwise get bump's answer for the latest tag and attach its zip to that version.
    tags = release_tags()
    if tags and git("merge-base", "--is-ancestor", tags[0], sha).returncode != 0:
        raise Stop(f"{sha[:9]} isn't after the latest release {tags[0]}: an older commit is never released.", REFUSED)
    if not os.path.isfile(CONTENT):
        raise Stop(f"No {CONTENT}: the release job takes the build's content artifact (the deploy's build).")
    r = subprocess.run(["npx", "projen", "bump"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    say(r.stdout.rstrip())
    if r.returncode != 0:
        raise Stop("npx projen bump failed (above).")
    tag_file = os.path.join("dist", "releasetag.txt")
    if not os.path.isfile(tag_file):
        raise Stop("bump wrote no version (it skips a commit whose subject starts with `chore(release):`).")
    with open(tag_file) as f:
        tag = f.read().strip()
    if not RELEASE_TAG.match(tag):
        raise Stop(f"bump made the tag {tag!r}, not v<major>.<minor>.<patch>.")
    if tag in tags:
        raise Stop(f"bump made {tag}, which is already a release: a version is never reused.")
    notes = os.path.join("dist", "changelog.md")
    create(tag, sha, notes)
    say(f"✅ Released {tag} at {sha[:9]}: `npx projen publish` sends it.")


def main():
    try:
        release()
        code = OK
    except Stop as e:
        say(f"❌ {e}")
        code = e.code
    except Exception as e:  # noqa: BLE001 (an unexpected error is still a RESULT line: failed part way)
        say(f"❌ release failed: {type(e).__name__}: {e}")
        code = FAILED
    print(f"RESULT code={code} step=release")
    return code


if __name__ == "__main__":
    sys.exit(main())
