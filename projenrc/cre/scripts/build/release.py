#!/usr/bin/env python3
"""release.py — a Workshop Studio workshop's release of a commit whose code a deploy tested.

CI runs it (the `release` task) on the commit it releases; CRE_RELEASE_TRIGGER says why:

  deploy  the deploy of this commit succeeded (GitHub's `release` workflow after the `deploy` run,
          GitLab's deploy:release job): release it.
  guide   a push to main changed the guide (content/, static/, ...): release it when its code (every
          path but CRE_RELEASE_IGNORE's) is the latest release's, which a deploy tested; else skip,
          because the deploy of this commit releases it.
  manual  run by hand on main's head: release it under the same code check, else refused.

The release is how a publish knows which commit to send: `npx projen publish` sends the latest
release (or the one `--version` names), never main's head. `--check` only decides: it prints
`RELEASE=true|false` (and writes `release=` to $GITHUB_OUTPUT), so the workflow builds only for a
release it will make.

  1. Already released (a `v<semver>` tag points at this commit: a re-run, a redeploy): nothing to do.
  2. The next version: projen's `bump` (the same as projen's own release: the latest `v*` tag, the
     conventional commits since it, commit-and-tag-version), which writes dist/releasetag.txt and
     dist/changelog.md. Nothing is committed: the version lives in the tag alone.
  3. The tag and the release at this commit, with that changelog and dist/content.zip (the build
     the deploy deployed, from its CI artifact): GitHub through `gh` with the job's token
     (contents: write), the zip a release asset; GitLab with the job's own CI_JOB_TOKEN, the zip
     uploaded to the project's generic package registry (`<project>/<version>/content.zip`), then
     the release through the Releases API, which creates the tag at `ref` and links the zip.

Exit 0 released (or nothing to do) | 10 refused (not in CI, a commit older than the latest release, a
manual release of code no deploy tested) | 20 failed. Last stdout line `RESULT code=<n> step=release`.
"""
import argparse
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


TRIGGERS = ("deploy", "guide", "manual")


def ignored_paths():
    """The paths a deploy doesn't depend on (the guide, docs), as git exclude pathspecs."""
    return [f":(exclude,glob){p}" for p in os.environ.get("CRE_RELEASE_IGNORE", "").split()]


def code_changed(since, sha):
    """Whether anything a deploy depends on differs between `since` and `sha`."""
    r = git("diff", "--quiet", since, sha, "--", ".", *ignored_paths())
    if r.returncode not in (0, 1):
        raise Stop(f"git diff {since} {sha[:9]} failed: {r.stderr.strip()}")
    return r.returncode == 1


def decide(sha, trigger):
    """Whether to release `sha` (True), or nothing to do (False); a refusal raises Stop."""
    done = release_tags(sha)
    if done:
        say(f"✓  {sha[:9]} is released already as {done[0]}: nothing to do.")
        return False
    # Only a commit after the latest release: an older run (a retry, an overlap) would otherwise get
    # bump's answer for the latest tag and attach its zip to that version.
    tags = release_tags()
    if tags and git("merge-base", "--is-ancestor", tags[0], sha).returncode != 0:
        raise Stop(f"{sha[:9]} isn't after the latest release {tags[0]}: an older commit is never released.", REFUSED)
    if trigger == "deploy":
        return True
    # Code a deploy tested: the latest release's (every release's code was deployed: a deploy's
    # release, or one whose code was a release's before it), or the last successful deploy's
    # (CRE_DEPLOYED_SHA, from the provider), whose own release may not have been made.
    deployed = os.environ.get("CRE_DEPLOYED_SHA", "").strip()
    bases = [b for b in (tags[0] if tags else "", deployed) if b and git("cat-file", "-e", f"{b}^{{commit}}").returncode == 0]
    if not bases:
        why = "there is no release yet: the first one comes from a deploy"
    elif all(code_changed(b, sha) for b in bases):
        why = f"its code differs from the latest release {tags[0] if tags else '(none)'}" + \
              (f" and from the last deployed commit {deployed[:9]}" if deployed else "") + ", so no deploy has tested it yet"
    else:
        return True
    if trigger == "guide":
        say(f"ℹ  Not releasing {sha[:9]} for its guide change: {why}. The deploy of this commit releases it.")
        return False
    raise Stop(f"Not releasing {sha[:9]}: {why}. Let its deploy finish (it releases it), then run this again.", REFUSED)


def trigger_of():
    trigger = os.environ.get("CRE_RELEASE_TRIGGER") or "deploy"
    if trigger not in TRIGGERS:
        raise Stop(f"CRE_RELEASE_TRIGGER={trigger!r}: one of {', '.join(TRIGGERS)}.", REFUSED)
    return trigger


def check():
    """--check: decide only, for the workflow's later steps."""
    if not (os.environ.get("GITHUB_ACTIONS") or os.environ.get("GITLAB_CI")):
        raise Stop("Not in CI: a release is made only by CI.", REFUSED)
    git("fetch", "-q", "--tags", "--force", "origin")
    go = decide(git("rev-parse", "HEAD").stdout.strip(), trigger_of())
    print(f"RELEASE={'true' if go else 'false'}")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"release={'true' if go else 'false'}\n")


def release():
    create = create_github if os.environ.get("GITHUB_ACTIONS") else create_gitlab if os.environ.get("GITLAB_CI") else None
    if create is None:
        raise Stop("Not in CI: a release is made only by CI.", REFUSED)
    trigger = trigger_of()
    # Every tag: the next version continues from the latest one (a CI clone may have none fetched).
    git("fetch", "-q", "--tags", "--force", "origin")
    sha = git("rev-parse", "HEAD").stdout.strip()
    if not decide(sha, trigger):
        return
    tags = release_tags()
    if not os.path.isfile(CONTENT):
        raise Stop(f"No {CONTENT}: the release takes the deploy's build artifact, or builds it first.")
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


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise Stop(f"{message} (usage: release.py [--check])", REFUSED)


def parse(argv):
    p = Parser(prog="release.py", description="CI: tag and release a commit whose code a deploy tested "
               "(CRE_RELEASE_TRIGGER deploy, guide or manual).")
    p.add_argument("--check", action="store_true", help="only decide: print RELEASE=true|false (and release= to $GITHUB_OUTPUT)")
    return p.parse_args(argv)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    try:
        check() if parse(argv).check else release()
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
