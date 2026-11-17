#!/usr/bin/env python3
"""deploy:docker — push the pre-built image tarballs to ECR in the regions of the stacks that use them.

  deploy-docker.py --stack-regions "<stack>=<region> ..."

Expects the build to have produced (in dist/content.zip, unpacked by deploy:s3):
  dist/content/containers/manifest.json    (container-plan.py)
  dist/content/containers/<hash>.tar.gz    (build-docker.py, or kaniko-build.sh on GitLab)

Pushes with `crane` (https://github.com/google/go-containerregistry), a static binary that speaks
the registry protocol: no docker daemon, so it works on the restricted CI runners. The deploy never
builds an image, so it never runs a Dockerfile from a PR.

Each image goes to the regions of the stacks that use it: the manifest records the stacks (from each
<stack>.assets.json), --stack-regions (what deploy:docker passes, generated from the stacks'
regions) says where each stack deploys. An image used by a stack the mapping doesn't name is an
error. Idempotent: an existing repository is kept, and an image tag already present isn't pushed.
The ECR password goes to crane on its stdin, never its command line.

Exit 0 pushed (or nothing to push) | 1 a missing tarball or tool, no credentials, a failed push |
64 bad arguments.
"""
import argparse
import gzip
import json
import os
import shutil
import sys
import tempfile

sys.dont_write_bytecode = True  # never a __pycache__ in the template clone or projenrc/cre
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import crelib  # noqa: E402
import aws as awscli  # noqa: E402  (cresetup/, on the path through crelib: the one aws CLI runner)
from result import Failed  # noqa: E402


class Fail(Exception):
    pass


aws = awscli.Aws(timeout=None).call


def regions_for(img, stack_regions):
    users = img.get("stacks") or []
    unknown = [s for s in users if s not in stack_regions]
    if not users or unknown:
        raise Fail(f"image {img['hash']} is used by {unknown or 'no recorded stack'}, which cre-stacks.json does not name")
    return list(dict.fromkeys(stack_regions[s] for s in users))


def fill(template, account, region):
    return template.replace("${AWS::AccountId}", account).replace("${AWS::Region}", region)


def push_region(img, tar, account, region, crane_env):
    repo, tag = fill(img["repository"], account, region), fill(img["tag"], account, region)
    print(f"\n--- {region}: {repo}:{tag} ---", flush=True)
    r = aws("ecr", "get-authorization-token", "--region", region, "--query", "authorizationData[0].proxyEndpoint",
            "--output", "text")
    if not r.ok or not r.out.strip():
        raise Fail(f"ecr get-authorization-token failed in {region}: {r.message}")
    # ECR's own answer for the registry host: the domain differs by partition, so it's never assembled.
    registry = r.out.strip().replace("https://", "", 1)
    if aws("ecr", "describe-repositories", "--region", region, "--repository-names", repo).ok:
        print("  repo exists")
    else:
        c = aws("ecr", "create-repository", "--region", region, "--repository-name", repo,
                "--image-scanning-configuration", "scanOnPush=true", "--encryption-configuration", "encryptionType=AES256")
        if not c.ok:
            raise Fail(f"could not create ECR repository {repo} in {region}: {c.message}")
        print("  repo created")
    if aws("ecr", "describe-images", "--region", region, "--repository-name", repo, "--image-ids", f"imageTag={tag}").ok:
        print(f"  image tag {tag} already present — skipping push")
        return
    full = f"{registry}/{repo}:{tag}"
    pw = aws("ecr", "get-login-password", "--region", region)
    if not pw.ok or not pw.out.strip():
        raise Fail(f"ecr get-login-password failed in {region}: {pw.message}")
    # The login goes into this run's own docker config (crane_env), never the builder's: theirs may
    # name a credential helper that isn't installed, and a 12-hour ECR token would stay there (review 10d D6).
    login = crelib.run(["crane", "auth", "login", "--username", "AWS", "--password-stdin", registry], input=pw.out, env=crane_env)
    if login.returncode != 0:
        raise Fail(f"crane auth login to {registry} failed: {crelib.last_line(login.stderr)}")
    if crelib.stream(["crane", "push", tar, full], env=crane_env) != 0:
        raise Fail(f"crane push to {full} failed (above)")
    print(f"  pushed {full}")


def main(argv):
    p = argparse.ArgumentParser(prog="deploy-docker.py", allow_abbrev=False)
    p.add_argument("--stack-regions", required=True)
    try:
        a = p.parse_args(argv)
    except SystemExit as e:
        return 64 if e.code else 0
    stack_regions = dict(x.split("=", 1) for x in a.stack_regions.split() if "=" in x)
    content = os.path.join("dist", "content")
    manifest = os.path.join(content, "containers", "manifest.json")
    if not os.path.isfile(manifest):
        print(f"Missing container manifest at {manifest}. Did build:docker run?", file=sys.stderr)
        return 1
    with open(manifest) as f:
        images = json.load(f)
    if not images:
        print("Manifest has zero images — nothing to push.")
        return 0
    if shutil.which("crane") is None:
        print("ERROR: crane not found on PATH (the local deploy pushes images with it; CI installs it itself).\n"
              "Install it: brew install crane   (or https://github.com/google/go-containerregistry/releases)", file=sys.stderr)
        return 1
    try:
        account = awscli.identity(aws)[0]
    except Failed as e:
        print(f"❌ deploy:docker: no usable AWS credentials ({e}).", file=sys.stderr)
        return 1
    print(f"Deploying account: {account}\nPushing {len(images)} image(s) from {content}/containers/ via crane")
    # A docker config for this run only, removed at the end with the ECR logins in it.
    cfg = tempfile.mkdtemp(prefix="cre-crane-")
    with open(os.path.join(cfg, "config.json"), "w") as f:
        json.dump({"auths": {}}, f)
    crane_env = {"DOCKER_CONFIG": cfg}
    try:
        for img in images:
            regions = regions_for(img, stack_regions)
            gz = os.path.join(content, "containers", f"{img['hash']}.tar.gz")
            if not os.path.isfile(gz):
                raise Fail(f"image tar not found: {gz} (manifest referenced {img['hash']}).\n"
                           "  A local build without Docker skips the images (build:docker warns). Start Docker, run npx projen build, "
                           "then deploy.")
            print(f"\n=== {img['hash']} ===\n  regions: {','.join(regions)}", flush=True)
            # crane push reads uncompressed tarballs: decompress once, reuse across regions.
            tar = gz[: -len(".gz")]
            if not os.path.isfile(tar):
                with gzip.open(gz, "rb") as src, open(tar, "wb") as dst:
                    shutil.copyfileobj(src, dst)
            try:
                for region in regions:
                    push_region(img, tar, account, region.strip(), crane_env)
            finally:
                os.remove(tar)
    except Fail as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    finally:
        shutil.rmtree(cfg, ignore_errors=True)
    print("\nAll docker image assets pushed.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
