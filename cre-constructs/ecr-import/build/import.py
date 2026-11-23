"""CreEcrImport's build step: each artifact in $ARTIFACTS from S3 into its ECR repository.

ARTIFACTS is a JSON list of {kind, bucket, key, repository, tag, chartName?}, only the ones the
custom resource found missing from ECR. An image (`docker save` tarball) is loaded and pushed as it
is; a chart (`helm package` .tgz) is pushed as the OCI artifact `helm push` makes, through ECR's API
(no helm here). REGISTRY is `<account>.dkr.ecr.<region>.<suffix>`.
"""
import hashlib
import json
import os
import subprocess
import tarfile

REGISTRY = os.environ["REGISTRY"]
# Chart.yaml's string fields: helm reads the config into its chart metadata, so a field of another
# type (deprecated, keywords, maintainers, dependencies) given as a string would break `helm pull`.
CHART_STRINGS = ("apiVersion", "name", "version", "kubeVersion", "description", "type", "home", "icon", "appVersion")


def run(*cmd, stdin=None):
    try:
        return subprocess.run(cmd, check=True, capture_output=True, text=True, input=stdin).stdout
    except subprocess.CalledProcessError as e:
        # The error itself (access denied, a missing object, a bad manifest): CalledProcessError's
        # message is only the command and its exit. stderr only: a command's stdout can be a secret
        # (get-login-password).
        print(f"{' '.join(cmd[:3])} failed (exit {e.returncode}):\n{(e.stderr or '').strip()}", flush=True)
        raise


def ecr(*args):
    return json.loads(run("aws", "ecr", *args, "--output", "json") or "{}")


def push_image(a, logged_in):
    if not logged_in:
        run("docker", "login", "--username", "AWS", "--password-stdin", REGISTRY, stdin=run("aws", "ecr", "get-login-password"))
    loaded = run("docker", "load", "-i", "artifact")
    ref = [line.split(": ", 1)[1] for line in loaded.splitlines() if line.startswith("Loaded image")][-1]
    target = f"{REGISTRY}/{a['repository']}:{a['tag']}"
    run("docker", "tag", ref, target)
    run("docker", "push", target)


def upload(repo, blob):
    digest = "sha256:" + hashlib.sha256(blob).hexdigest()
    have = ecr("batch-check-layer-availability", "--repository-name", repo, "--layer-digests", digest).get("layers") or [{}]
    if have[0].get("layerAvailability") != "AVAILABLE":
        upload_id = ecr("initiate-layer-upload", "--repository-name", repo)["uploadId"]
        with open("part", "wb") as f:
            f.write(blob)
        ecr("upload-layer-part", "--repository-name", repo, "--upload-id", upload_id, "--part-first-byte", "0",
            "--part-last-byte", str(len(blob) - 1), "--layer-part-blob", "fileb://part")
        ecr("complete-layer-upload", "--repository-name", repo, "--upload-id", upload_id, "--layer-digests", digest)
    return digest


def chart_config():
    """Chart.yaml's top-level string fields, as helm's config blob."""
    with tarfile.open("artifact") as t:
        member = next(m for m in t.getmembers() if m.name.count("/") == 1 and m.name.endswith("/Chart.yaml"))
        text = t.extractfile(member).read().decode()
    conf = {}
    for line in text.splitlines():
        key, sep, value = line.partition(":")
        if sep and key in CHART_STRINGS and not line[0].isspace():
            value = value.split(" #", 1)[0].strip().strip("'\"")
            if value:
                conf[key] = value
    return json.dumps(conf).encode()


def push_chart(a):
    repo = a["repository"]
    with open("artifact", "rb") as f:
        chart = f.read()
    config = chart_config()
    manifest = {
        "schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json",
        "config": {"mediaType": "application/vnd.cncf.helm.config.v1+json", "digest": upload(repo, config), "size": len(config)},
        "layers": [{"mediaType": "application/vnd.cncf.helm.chart.content.v1.tar+gzip", "digest": upload(repo, chart), "size": len(chart)}],
    }
    ecr("put-image", "--repository-name", repo, "--image-tag", a["tag"], "--image-manifest", json.dumps(manifest),
        "--image-manifest-media-type", "application/vnd.oci.image.manifest.v1+json")


def main():
    logged_in = False
    for a in json.loads(os.environ["ARTIFACTS"]):
        run("aws", "s3", "cp", f"s3://{a['bucket']}/{a['key']}", "artifact", "--only-show-errors")
        if a["kind"] == "image":
            push_image(a, logged_in)
            logged_in = True
        else:
            push_chart(a)
        print(f"pushed {a['kind']} {a['repository']}:{a['tag']}", flush=True)


if __name__ == "__main__":
    main()
