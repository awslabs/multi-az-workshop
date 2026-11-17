#!/usr/bin/env sh
#
# The GitLab build:docker job: build every DockerImageAsset listed in dist/container-plan.tsv with
# kaniko and save each one to assets/containers/<hash>.tar.gz.
#
# Kaniko is used here instead of `docker build` because the shared GitLab runner fleet doesn't
# allow Docker-in-Docker and blocks the CLONE_NEWUSER syscall that rootless podman/buildah need.
# Kaniko builds OCI images in a chroot — no daemon, no user namespaces. Everywhere else (GitHub
# runners, laptops) `build:docker` runs build-docker.py, a plain `docker build`.
#
# Written for the kaniko `:debug` image, which is distroless + busybox — so no python, no apk, no
# bash. Everything here is POSIX sh + busybox coreutils. The JSON work (enumerating CDK assets,
# writing manifest.json) is container-plan.py's, on the node image, which writes the plain-text
# plan this reads.
#
# Optional env:
#   KANIKO_EXECUTOR      Defaults to /kaniko/executor (the job image's).
#   CONTAINER_PLAN_FILE  Defaults to dist/container-plan.tsv.
#   CONTAINERS_DIR       Defaults to assets/containers.
#   CONTAINER_CACHE_DIR  Persistent content-addressed tarball cache. Defaults to dist/.cache/containers.
#   CRE_IMAGE_REBUILD    1: ignore the cache and build every image (the weekly scheduled pipeline).
#
# CACHING: CDK image hashes are content hashes of the build context, so an existing <hash>.tar.gz is
# what a rebuild would produce. On a cache hit the tarball is reused and kaniko is skipped — no
# base-image pull (so no public.ecr.aws rate-limit hit) and no recompile. The build:docker job's
# GitLab `cache:` block persists dist/.cache/containers across pipelines (keyed per branch).

set -eu

KANIKO_EXECUTOR="${KANIKO_EXECUTOR:-/kaniko/executor}"
CONTAINER_PLAN_FILE="${CONTAINER_PLAN_FILE:-dist/container-plan.tsv}"
CONTAINERS_DIR="${CONTAINERS_DIR:-assets/containers}"
CONTAINER_CACHE_DIR="${CONTAINER_CACHE_DIR:-dist/.cache/containers}"

mkdir -p "$CONTAINERS_DIR"

# ---- preflight ------------------------------------------------------------

if [ ! -f "$CONTAINER_PLAN_FILE" ]; then
  echo "ERROR: container plan file not found: $CONTAINER_PLAN_FILE" >&2
  echo "  (did build:container-plan / yarn ci:build:container-plan run?)" >&2
  exit 1
fi

# Count non-empty lines — gives us "0 images" detection without any jq/python.
COUNT=$(grep -cv '^[[:space:]]*$' "$CONTAINER_PLAN_FILE" || true)
if [ "$COUNT" = "0" ]; then
  echo "Container plan is empty — nothing to build."
  exit 0
fi

if [ ! -x "$KANIKO_EXECUTOR" ]; then
  echo "ERROR: no kaniko executor at $KANIKO_EXECUTOR: this script is the GitLab build:docker job's, on the kaniko image." >&2
  echo "  Elsewhere, npx projen build:docker builds the images with docker (build-docker.py)." >&2
  exit 1
fi

echo "Building $COUNT image(s) from $CONTAINER_PLAN_FILE into $CONTAINERS_DIR"

REPO_ROOT="$(pwd)"

# ---- build loop -----------------------------------------------------------

# Read tab-separated plan file line by line. Busybox `read -r` splits on
# IFS; we set IFS to tab explicitly so hashes containing no tabs are
# safe and the third field captures the platform unchanged.
while IFS="$(printf '\t')" read -r IMAGE_HASH DIRECTORY PLATFORM DOCKERFILE; do
  DOCKERFILE="${DOCKERFILE:-Dockerfile}"
  ARGS_FILE="$(dirname "$CONTAINER_PLAN_FILE")/container-args-${IMAGE_HASH}.txt"
  # Skip blank lines defensively — they shouldn't exist but grep -v handled
  # counting and we'd rather survive stray whitespace than fail loudly here.
  [ -z "${IMAGE_HASH:-}" ] && continue

  FINAL_TARGZ="$CONTAINERS_DIR/${IMAGE_HASH}.tar.gz"
  CACHED_TARGZ="$CONTAINER_CACHE_DIR/${IMAGE_HASH}.tar.gz"

  # Cache hit: an identical image (same content hash) was already built — reuse it and skip
  # kaniko entirely (this is what makes an unchanged build a near no-op). Checked BEFORE the
  # staged-dir check because a cache hit needs neither cdk.out nor a base-image pull.
  # CRE_IMAGE_REBUILD=1 (the weekly scheduled pipeline) builds every image again, OS updates included.
  if [ -f "$CACHED_TARGZ" ] && [ "${CRE_IMAGE_REBUILD:-}" != 1 ]; then
    echo
    echo "=== $IMAGE_HASH === (cache hit — reusing $CACHED_TARGZ, no rebuild)"
    cp "$CACHED_TARGZ" "$FINAL_TARGZ"
    continue
  fi

  STAGED_DIR="cdk.out/$DIRECTORY"   # the staged asset directories the plan names
  if [ ! -d "$STAGED_DIR" ]; then
    echo "ERROR: staged directory not found: $STAGED_DIR" >&2
    exit 1
  fi

  TAR_PATH="$CONTAINERS_DIR/${IMAGE_HASH}.tar"

  echo
  echo "=== $IMAGE_HASH ==="
  echo "  source:   $STAGED_DIR"
  echo "  platform: $PLATFORM"
  echo "  tar:      ${TAR_PATH}.gz"

  # --no-push: we're just producing a tarball, not touching a registry
  # --tarPath: emit docker-archive format for crane/skopeo/docker-load consumption
  # --destination: required even with --no-push, used as the image's
  #                canonical reference inside the tarball
  # --custom-platform: honor the platform from the CDK asset (arm64
  #                    for our Locust container).
  # --cleanup: kaniko unpacks each base image over the container's own root filesystem, so
  #            without it the next image in this loop starts on the previous one's files.
  # Kaniko runs RUN steps on this machine's CPU: it can't build an image for another
  # architecture that executes anything (no emulation on the CI runners; review N12). Say so
  # before a cryptic `exec format error` halfway through.
  case "$(uname -m)" in x86_64 | amd64) HOST_ARCH=amd64 ;; aarch64 | arm64) HOST_ARCH=arm64 ;; *) HOST_ARCH="" ;; esac
  WANT_ARCH="${PLATFORM#*/}"; WANT_ARCH="${WANT_ARCH%%/*}"
  if [ -n "$HOST_ARCH" ] && [ -n "$WANT_ARCH" ] && [ "$WANT_ARCH" != "$HOST_ARCH" ] &&
    grep -qiE '^[[:space:]]*RUN[[:space:]]' "$STAGED_DIR/$DOCKERFILE" 2>/dev/null; then
    echo "ERROR: image $IMAGE_HASH is $PLATFORM, but this runner is linux/$HOST_ARCH and its Dockerfile has RUN steps," >&2
    echo "  which kaniko can't execute for another architecture. Build it for linux/$HOST_ARCH: set" >&2
    echo "  platform: Platform.LINUX_$(echo "$HOST_ARCH" | tr a-z A-Z) on the image asset (and the matching" >&2
    echo "  runtimePlatform on its Fargate task / Lambda architecture)." >&2
    exit 1
  fi
  # The asset's target and build args (container-plan.py writes the file for every image, empty when
  # there are none), one flag per line, as "$@". A missing file means the job didn't get it: building
  # without it would make a different image under the same hash (review 10c D1).
  if [ ! -f "$ARGS_FILE" ]; then
    echo "ERROR: $ARGS_FILE is missing: the build args and target of image $IMAGE_HASH didn't reach this job." >&2
    echo "  (build:container-plan must publish dist/container-args-*.txt as an artifact)" >&2
    exit 1
  fi
  set --
  while IFS= read -r A; do [ -n "$A" ] && set -- "$@" "$A"; done <"$ARGS_FILE"
  "$KANIKO_EXECUTOR" "$@" \
    --dockerfile="$REPO_ROOT/$STAGED_DIR/$DOCKERFILE" \
    --context="$REPO_ROOT/$STAGED_DIR" \
    --destination="cdk-asset:$IMAGE_HASH" \
    --tarPath="$REPO_ROOT/$TAR_PATH" \
    --custom-platform="$PLATFORM" \
    --no-push \
    --cleanup

  # Kaniko emits an uncompressed tar; compress to match the .tar.gz
  # convention the manifest advertises.
  gzip -f "$TAR_PATH"

  # Populate the content-addressed cache so the next build (local or, via GitLab cache, CI)
  # reuses this exact image instead of pulling + rebuilding.
  mkdir -p "$CONTAINER_CACHE_DIR"
  cp "$FINAL_TARGZ" "$CACHED_TARGZ"
done < "$CONTAINER_PLAN_FILE"

# Drop cached tarballs of images the plan no longer has: the job caches the whole directory, which
# otherwise grows by one image per change and is downloaded in full by every job (review 10c D4).
if [ -d "$CONTAINER_CACHE_DIR" ]; then
  for f in "$CONTAINER_CACHE_DIR"/*.tar.gz; do
    [ -e "$f" ] || continue
    h=$(basename "$f" .tar.gz)
    if ! cut -f1 "$CONTAINER_PLAN_FILE" | grep -qxF "$h"; then
      rm -f "$f"
      echo "Dropped the cached image $h (no longer in the plan)."
    fi
  done
fi

echo
echo "Built $COUNT image(s)."
