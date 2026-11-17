#!/usr/bin/env python3
"""Delete old deploy prefixes from the assets buckets, keeping the current deploy plus the two
before it. Runs as the last deploy phase, only after every stack deployed.

  PROJECT_NAME   prefixes live under s3://<bucket>/<PROJECT_NAME>/
  ASSETS_PREFIX  this deploy's prefix (always kept)
  PRUNE_REGIONS  space-separated regions; each one's bucket is named from PROJECT_NAME and the
                 account the credentials are for (assets.py)
  PRUNE_KEEP     previous prefixes to keep besides the current one (default 2)

A prefix is a deploy prefix only if its name is a run id (`<project>/<digits>/`: GitLab's pipeline
id, GitHub's run id) or a UTC timestamp (`<project>/YYYY-MM-DDTHH-MM-SSZ/`, a local deploy).
Anything else under the project, and anything outside it, is never touched. Prefixes are ordered by
their newest object's LastModified, because the two naming schemes don't sort against each other.

Only prefixes OLDER than this deploy's are candidates: on GitLab another pipeline may have uploaded
a newer prefix and still be waiting for its stacks' resource groups, and deleting it would fail its
deploys (review 10b D2). The current one's age is its newest object's.

Never fails the deploy: problems are reported as warnings and the script exits 0. The stacks are
already deployed by the time this runs, and the worst case of not pruning is a larger bucket.
"""
import os
import re
import sys

sys.dont_write_bytecode = True  # never a __pycache__ in the template clone or projenrc/cre
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import crelib  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import assets  # noqa: E402
import aws as awscli  # noqa: E402  (cresetup/, on the path through crelib: the one aws CLI runner)



warn = lambda msg: crelib.warn(f"prune: {msg}")   # crelib's printer (review 10c G5)


def to_delete(listing, project, current, keep):
    """The prefixes to delete, given `<key>\\t<LastModified>` lines."""
    pat = re.compile(r"^" + re.escape(project) + r"/(\d+|\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)/")
    newest = {}
    for line in listing.splitlines():
        parts = line.split("\t")
        if len(parts) != 2 or parts[0] == "None":
            continue
        m = pat.match(parts[0])
        if m:
            newest[m.group(0)] = max(newest.get(m.group(0), ""), parts[1])
    mine = newest.get(current)
    if mine is None:
        return []   # this deploy uploaded nothing here: no reference point, so delete nothing
    older = sorted((p for p in newest if p != current and newest[p] < mine), key=lambda p: newest[p], reverse=True)
    return older[keep:]


aws = awscli.Aws(timeout=None).call


def main():
    project = os.environ.get("PROJECT_NAME", "")
    prefix = os.environ.get("ASSETS_PREFIX", "")
    if not project or not prefix:
        warn("PROJECT_NAME and ASSETS_PREFIX must be set; nothing pruned")
        return 0
    try:
        keep = int(os.environ.get("PRUNE_KEEP") or 2)
    except ValueError:
        warn(f"PRUNE_KEEP={os.environ['PRUNE_KEEP']!r} is not a number; using 2")
        keep = 2
    current = prefix.rstrip("/") + "/"
    regions = (os.environ.get("PRUNE_REGIONS") or "").split()
    try:
        account = assets.account() if regions else ""
    except assets.Fail as e:
        warn(f"{e}; nothing pruned")
        return 0
    for name in regions:
        # Call S3 in the bucket's region (no redirect, and a scoped policy needn't allow the CLI's
        # region lookup; review N5).
        bucket = assets.bucket_name(project, account, name)
        region = ["--region", name]
        r = aws("s3api", "list-objects-v2", *region, "--bucket", bucket, "--prefix", f"{project}/",
                "--query", "Contents[].[Key,LastModified]", "--output", "text")
        if not r.ok:
            warn(f"could not list s3://{bucket}/{project}/ ({r.message}); skipping this bucket")
            continue
        delete = to_delete(r.out, project, current, keep)
        if not delete:
            print(f"prune: s3://{bucket} — nothing to delete (keeping {current} + {keep} previous)")
            continue
        for p in delete:
            d = aws("s3", "rm", *region, "--recursive", "--only-show-errors", f"s3://{bucket}/{p}")
            if d.ok:
                print(f"prune: deleted s3://{bucket}/{p}")
            else:
                warn(f"failed to delete s3://{bucket}/{p} ({d.message})")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # never fail the deploy
        warn(f"unexpected error, nothing more pruned: {e}")
        sys.exit(0)
