#!/usr/bin/env python3
"""build:docker — build every DockerImageAsset in dist/container-plan.tsv with `docker build`, and
save each to assets/containers/<hash>.tar.gz (it rides in dist/content.zip; deploy:docker pushes it
with crane).

Runs on GitHub runners and laptops (any `docker`: Docker Engine, Docker Desktop, Podman's docker
CLI). The GitLab build:docker job uses kaniko-build.sh instead: the shared GitLab runners allow no
Docker daemon (Docker-in-Docker is blocked, and rootless podman/buildah need CLONE_NEWUSER).

Each image is built for the asset's platform (`docker build --platform`), from its Dockerfile, with
its target and build args (container-plan.py), then `docker save`d. An image for the other
architecture needs QEMU binfmt handlers (the GitHub workflows set them up; Docker Desktop has them).

Cache: CDK image hashes are content hashes of the build context, so a tarball already in
dist/.cache/containers/<hash>.tar.gz is what a rebuild would make; it is reused and docker isn't
called. pre-compile doesn't wipe dist/.cache.

No docker here (and not in CI): a warning, exit 0 (CI builds the images; a local deploy of this
build then names the missing tarballs). CRE_REQUIRE_IMAGES=1, or CI set: an error.

Env: CONTAINER_PLAN_FILE (dist/container-plan.tsv), CONTAINERS_DIR (assets/containers),
CONTAINER_CACHE_DIR (dist/.cache/containers), CRE_IMAGE_REBUILD (1: ignore the cache and build every
image with --no-cache --pull, as the weekly scheduled pipeline does). The build contexts are under
cdk.out. Exit 0 | 1.
"""
import gzip
import os
import shutil
import sys

sys.dont_write_bytecode = True  # never a __pycache__ in the template clone or projenrc/cre
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import crelib  # noqa: E402


def env(name, default):
    return os.environ.get(name) or default


def docker_ready():
    return shutil.which("docker") is not None and crelib.run(["docker", "info"]).returncode == 0


def build_args(plan_file, image_hash):
    path = os.path.join(os.path.dirname(plan_file), f"container-args-{image_hash}.txt")
    # container-plan.py writes one per image (empty when it has no args): missing means a stale plan,
    # and building without it would make a different image under the same hash (review 10c D1).
    try:
        with open(path) as f:
            return [line.rstrip("\n") for line in f if line.strip()]
    except FileNotFoundError:
        # Named, as kaniko-build.sh names it, not a traceback (review 10d E3).
        raise SystemExit(f"ERROR: {path} is missing: the build args and target of image {image_hash} aren't known, so "
                         "it isn't built (a stale plan). Run npx projen build:container-plan, then build again.")


def main():
    plan_file = env("CONTAINER_PLAN_FILE", os.path.join("dist", "container-plan.tsv"))
    out_dir = env("CONTAINERS_DIR", os.path.join("assets", "containers"))
    cdk_out = "cdk.out"
    cache = env("CONTAINER_CACHE_DIR", os.path.join("dist", ".cache", "containers"))
    if not os.path.isfile(plan_file):
        print(f"ERROR: container plan file not found: {plan_file} (did build:container-plan run?)", file=sys.stderr)
        return 1
    with open(plan_file) as f:
        rows = [line.rstrip("\n").split("\t") for line in f if line.strip()]
    if not rows:
        print("Container plan is empty — nothing to build.")
        return 0
    os.makedirs(out_dir, exist_ok=True)

    # CRE_IMAGE_REBUILD=1 (the weekly scheduled pipeline): build every image again, base image and
    # OS updates included, instead of reusing the cached tarball of the same asset hash.
    rebuild = os.environ.get("CRE_IMAGE_REBUILD") == "1"
    todo = [r for r in rows if rebuild or not os.path.isfile(os.path.join(cache, f"{r[0]}.tar.gz"))]
    if todo and not docker_ready():
        # Podman works through a `docker` name (review 10c A16).
        podman = shutil.which("podman") if not shutil.which("docker") else None
        hint = (f"podman is installed: link it as docker (ln -s {podman} ~/bin/docker, with ~/bin on PATH) and start its machine"
                if podman else "start Docker")
        if not os.environ.get("CI") and not os.environ.get("CRE_REQUIRE_IMAGES"):
            print("⚠  No Docker here: the container images are NOT built locally. CI builds them.\n"
                  f"   To build them here, {hint}; CRE_REQUIRE_IMAGES=1 makes this an error.", file=sys.stderr)
            return 0
        print("ERROR: docker isn't available (or its daemon isn't running): cannot build the images.", file=sys.stderr)
        return 1

    print(f"Building {len(rows)} image(s) from {plan_file} into {out_dir}")
    for row in rows:
        image_hash, directory, platform = row[0], row[1], row[2]
        dockerfile = row[3] if len(row) > 3 and row[3] else "Dockerfile"
        final = os.path.join(out_dir, f"{image_hash}.tar.gz")
        cached = os.path.join(cache, f"{image_hash}.tar.gz")
        if os.path.isfile(cached) and not rebuild:
            print(f"\n=== {image_hash} === (cache hit — reusing {cached}, no rebuild)")
            shutil.copyfile(cached, final)
            continue
        context = os.path.join(cdk_out, directory)
        if not os.path.isdir(context):
            print(f"ERROR: staged directory not found: {context}", file=sys.stderr)
            return 1
        tag = f"cdk-asset:{image_hash}"
        print(f"\n=== {image_hash} ===\n  source:   {context}\n  platform: {platform}\n  tar:      {final}", flush=True)
        # Run in the context, the Dockerfile relative to it: podman copied an absolute -f path into
        # the image through `COPY . .` (review 10c A16).
        fresh = ["--no-cache", "--pull"] if rebuild else []
        cmd = ["docker", "build", *fresh, "--platform", platform, "-f", dockerfile, *build_args(plan_file, image_hash), "-t", tag, "."]
        if crelib.stream(cmd, cwd=context) != 0:
            print(f"ERROR: docker build failed for image {image_hash} ({context}/{dockerfile}).", file=sys.stderr)
            return 1
        tar = os.path.join(out_dir, f"{image_hash}.tar")
        if crelib.stream(["docker", "save", "-o", tar, tag]) != 0:
            print(f"ERROR: docker save failed for image {image_hash}.", file=sys.stderr)
            return 1
        with open(tar, "rb") as src, gzip.open(final, "wb") as dst:
            shutil.copyfileobj(src, dst)
        os.remove(tar)
        os.makedirs(cache, exist_ok=True)
        shutil.copyfile(final, cached)
    prune_cache(cache, {r[0] for r in rows})
    print(f"\nBuilt {len(rows)} image(s).")
    return 0


def prune_cache(cache, keep):
    """Drop cached tarballs of images the plan no longer has (kaniko-build.sh does the same; review 10c D4)."""
    if not os.path.isdir(cache):
        return
    for f in sorted(os.listdir(cache)):
        if f.endswith(".tar.gz") and f[:-len(".tar.gz")] not in keep:
            os.remove(os.path.join(cache, f))
            print(f"Dropped the cached image {f[:-len('.tar.gz')]} (no longer in the plan).")


if __name__ == "__main__":
    sys.exit(main())
