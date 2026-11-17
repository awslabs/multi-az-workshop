#!/usr/bin/env python3
"""build:container-plan — the container build plan, from cdk.out/*.assets.json.

Enumerates the unique DockerImageAssets and writes:

  assets/containers/manifest.json   what deploy-docker.py pushes (rides in dist/content.zip):
      [{"hash", "platform", "repository", "tag", "stacks": [the stacks whose templates use it]}]
  dist/container-plan.tsv           what the image builds read, one line per image:
      <hash>\\t<staged directory under cdk.out>\\t<platform>\\t<Dockerfile>
  dist/container-args-<hash>.txt    the asset's build flags, one per line (--target=…, --build-arg=K=V)

Two builders read the plan: build-docker.py (docker build, on GitHub runners and laptops) and
kaniko-build.sh (the GitLab build:docker job, on the kaniko image: busybox sh, no python, which is
why the plan is plain text). Both build what `cdk deploy` would: the asset's Dockerfile, target and
build args; options neither can honour fail here instead of being dropped (review 10b D5).

Which regions each image is pushed to is decided at deploy time from the stacks that use it
(deploy-docker.py --stack-regions); the build doesn't know.

Reads cdk.out. Exit 0 written (zero images only warns) | 1 an unusable asset.
"""
import glob
import json
import os
import sys

UNSUPPORTED = ("dockerBuildSecrets", "dockerBuildSsh", "networkMode", "dockerOutputs", "executable")
SKIP_DIRS = {"node_modules", ".venv", "__pycache__", ".git"}


def python_errors(context):
    """Syntax errors in the image's Python files. A broken workloadDirectory locustfile otherwise
    builds green and is found when the Fargate service fails to start at deploy (review 10d A3)."""
    errors = []
    for d, dirs, files in os.walk(context):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS)
        for name in sorted(files):
            if not name.endswith(".py"):
                continue
            p = os.path.join(d, name)
            try:
                with open(p, "rb") as f:
                    compile(f.read(), p, "exec", dont_inherit=True)
            except SyntaxError as e:
                errors.append(f"{os.path.relpath(p, context)}:{e.lineno}: {e.msg}")
            except ValueError as e:   # a NUL byte
                errors.append(f"{os.path.relpath(p, context)}: {e}")
    return errors


def plan(cdk_out):
    seen, entries = {}, []
    for assets_json in sorted(glob.glob(os.path.join(cdk_out, "*.assets.json"))):
        with open(assets_json) as f:
            manifest = json.load(f)
        # <stack>.assets.json: the stack whose template uses these images.
        stack = os.path.basename(assets_json)[: -len(".assets.json")]
        for image_hash, entry in (manifest.get("dockerImages") or {}).items():
            if image_hash in seen:
                if stack not in seen[image_hash]["stacks"]:
                    seen[image_hash]["stacks"].append(stack)
                continue
            src = entry["source"]
            dest = next(iter(entry["destinations"].values()))
            unsupported = [k for k in UNSUPPORTED if src.get(k)]
            if unsupported:
                raise ValueError(f"image {image_hash} ({stack}) uses {', '.join(unsupported)}, which the CI image build can't "
                                 "honour. Remove it from the DockerImageAsset.")
            args = ([f"--target={src['dockerBuildTarget']}"] if src.get("dockerBuildTarget") else []) + \
                   [f"--build-arg={k}={v}" for k, v in sorted((src.get("dockerBuildArgs") or {}).items())]
            if any("\n" in a for a in args):
                raise ValueError(f"image {image_hash}: a build arg contains a newline.")
            broken = python_errors(os.path.join(cdk_out, src["directory"]))
            if broken:
                raise ValueError(f"image {image_hash} ({stack}) has Python that doesn't parse, so its container would fail to "
                                 "start at deploy:\n" + "\n".join("  " + b for b in broken))
            e = {"hash": image_hash, "directory": src["directory"], "dockerfile": src.get("dockerFile") or "Dockerfile",
                 "args": args, "platform": src.get("platform", "linux/amd64"), "repository": dest["repositoryName"],
                 "tag": dest["imageTag"], "stacks": [stack]}
            if not src.get("platform"):
                # GitLab's arm64 kaniko runners refuse an image for another platform when its
                # Dockerfile has RUN steps; GitHub (QEMU) and Docker Desktop build it, so a move to
                # GitLab turns a green project red. Said here, before any runner (review 10c D10).
                print(f"⚠  Image {image_hash} (stack {stack}) has no platform; it is planned as {e['platform']}. Set it on the "
                      "asset (platform: Platform.LINUX_ARM64, or LINUX_AMD64 to match its task): GitLab's arm64 runners refuse "
                      "another platform when the Dockerfile has RUN steps.", file=sys.stderr)
            seen[image_hash] = e
            entries.append(e)
    return entries


def main():
    cdk_out = "cdk.out"
    if not os.path.isdir(cdk_out):
        print(f"ERROR: {cdk_out} not found (did synth run?)", file=sys.stderr)
        return 1
    try:
        entries = plan(cdk_out)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    os.makedirs(os.path.join("assets", "containers"), exist_ok=True)
    os.makedirs("dist", exist_ok=True)
    manifest_path = os.path.join("assets", "containers", "manifest.json")
    with open(manifest_path, "w") as f:
        json.dump([{k: e[k] for k in ("hash", "platform", "repository", "tag", "stacks")} for e in entries], f, indent=2)
        f.write("\n")
    plan_path = os.path.join("dist", "container-plan.tsv")
    with open(plan_path, "w") as f:
        for e in entries:
            f.write(f"{e['hash']}\t{e['directory']}\t{e['platform']}\t{e['dockerfile']}\n")
            with open(os.path.join("dist", f"container-args-{e['hash']}.txt"), "w") as a:
                a.write("".join(x + "\n" for x in e["args"]))
    print(f"Wrote {len(entries)} image(s) to {manifest_path} and {plan_path}")
    if not entries:
        # containerImages is on before the app has an image (it is set when the design adds one):
        # the build and deploy steps handle zero images, so this warns rather than failing the build.
        print("WARNING: containerImages is on, but the app has no DockerImageAsset yet: nothing to build. "
              "Turn containerImages off in .projenrc.ts if no image is coming.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
