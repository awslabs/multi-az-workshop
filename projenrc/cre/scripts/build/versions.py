#!/usr/bin/env python3
"""versions:check / versions:update — the project's version file, build/versions.json.

Every externally sourced version the project deploys (Kubernetes, EKS add-ons, node and EC2 AMIs,
database engines, Helm charts, container images, released tools) lives in this one file, so the daily
upgrade can move them all, mechanically, with no judgment about where versions hide. An entry is
tracked only if its kind has a lookup below: a version nothing can look up is a version nothing
can keep current, so `check` refuses it.

    {
      "kubernetes": { "kind": "eks-kubernetes", "version": "1.35", "update": "none",
                      "note": "the demo's fault depends on 1.35's scheduler" },
      "vpcCni":     { "kind": "eks-addon", "addon": "vpc-cni", "version": "v1.22.4-eksbuild.14", "update": "minor" },
      "istio":      { "kind": "helm-chart", "repo": "https://istio-release.storage.googleapis.com/charts",
                      "chart": "istiod", "version": "1.29.10", "update": "patch" }
    }

`update` says how far the daily upgrade may move an entry, as npm's ranges do: `patch` is `~`
(1.29.0 -> 1.29.10), `minor` is `^` (1.29.0 -> 1.32.0), `major` is `*` (any newer version), `none`
is an exact pin. A version's parts are its numbers in order (v1.22.4-eksbuild.14 is 1, 22, 4, 14):
the first is the major, the second the minor, everything after a patch. A candidate must also have
the same shape as the current version (digits replaced, `1.29.0` never becomes `1.30.0-beta.1`).

  check    validate the file (no network). With --templates <cdk.out>, also refuse a synthesized
           template that takes a version from somewhere other than this file: an SSM-typed AMI
           parameter, an EKS add-on without AddonVersion, a managed node group without
           ReleaseVersion (or a launch template), an RDS engine without EngineVersion. Each leaves
           the version at whatever the service picked the day it was created. Exit 0 | 10 a bad
           file or template.
  update   look up each entry's newest allowed version and rewrite the file. EKS and RDS entries
           call AWS (read-only: eks:DescribeClusterVersions, eks:DescribeAddonVersions,
           rds:DescribeDBEngineVersions, ec2:DescribeImages, ssm:GetParameter on /aws/service/*)
           in $AWS_REGION; an ec2-ami entry's parameter is read in each region its ids name. A
           deprecated RDS version moves to the newest available one its update allows. The
           eks-kubernetes entry is resolved first, so add-ons, node AMIs and kubectl follow a new
           Kubernetes version in the same run. Exit 0 (changed or not) | 10 a bad file | 20 a
           lookup failed (nothing is written).

No file is not an error: there is nothing to check or update. Standard library only, so a project
outside the template (multi-az-workshop) can copy it as it is.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.dont_write_bytecode = True

DEFAULT_FILE = os.path.join("build", "versions.json")
BAD_FILE, LOOKUP_FAILED = 10, 20

UPDATES = ("none", "patch", "minor", "major")
# The first part index a change may touch under each update: major 0, minor 1, patch 2.
LOWEST_PART = {"major": 0, "minor": 1, "patch": 2}


class BadFile(Exception):
    pass


class LookupFailed(Exception):
    pass


# ---- kinds: the fields each needs, the updates it allows, and whether it calls AWS ----

KINDS = {
    # The cluster's Kubernetes version. Add-ons, node AMIs and kubectl follow it.
    "eks-kubernetes": {"fields": {}, "updates": UPDATES, "aws": True},
    # An EKS managed add-on (vpc-cni, kube-proxy, coredns, eks-pod-identity-agent, ...).
    "eks-addon": {"fields": {"addon": r"[a-z0-9][a-z0-9-]*"}, "updates": UPDATES, "aws": True},
    # A managed node group's AMI release version: `ami` is the EKS optimized AMI path under
    # /aws/service/eks/optimized-ami/<kubernetes>/, e.g. amazon-linux-2023/arm64/standard.
    "eks-node-ami": {"fields": {"ami": r"[a-z0-9-]+(/[a-z0-9-]+)*"}, "updates": ("none", "patch"), "aws": True},
    # An RDS / Aurora engine version (postgres, aurora-postgresql, mysql, aurora-mysql, ...). Its
    # major is RDS's MajorEngineVersion (MySQL 8.0 and 8.4 are different majors), and `minor` is any
    # newer version within it.
    "rds-engine": {"fields": {"engine": r"[a-z0-9-]+"}, "updates": ("none", "minor", "major"), "aws": True},
    # An EC2 AMI from a public SSM parameter (e.g.
    # /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64), with its id in every
    # region the project deploys to (`ids`: region -> AMI id, "" until the first update fills it).
    # `version` is the AMI's name. A stack reads its region's id from a CfnMapping, never from an
    # SSM-typed CloudFormation parameter, so a new AMI arrives only through this file.
    "ec2-ami": {"fields": {"parameter": r"/aws/service/\S+", "ids": None}, "updates": ("none", "patch"), "aws": True},
    # A Helm chart in an HTTPS chart repository (its index.yaml).
    "helm-chart": {"fields": {"repo": r"https://\S+", "chart": r"[A-Za-z0-9][A-Za-z0-9._-]*"}, "updates": UPDATES, "aws": False},
    # A container image's tag, from its registry (docker.io, public.ecr.aws, ghcr.io, quay.io, ...).
    "container-image": {"fields": {"image": r"[a-z0-9.-]+(:[0-9]+)?/[a-z0-9._/-]+"}, "updates": UPDATES, "aws": False},
    # A GitHub release's tag (owner/repo), drafts and prereleases left out.
    "github-release": {"fields": {"repo": r"[A-Za-z0-9-]+/[A-Za-z0-9._-]+"}, "updates": UPDATES, "aws": False},
    # A GitHub Action a workflow step `uses` (owner/repo): `version` is its release tag, `sha` the
    # commit that tag points to, which the workflow pins (a tag can be moved; a commit can't).
    # versions:update fills `sha` in ("" until then) and moves both together.
    "github-action": {"fields": {"repo": r"[A-Za-z0-9-]+/[A-Za-z0-9._-]+", "sha": r"([0-9a-f]{40})?"}, "updates": UPDATES, "aws": False},
    # An npm package the project type pins (aws-cdk-lib: its `cdkVersion`), from the npm registry:
    # deprecated versions and prereleases left out. The daily upgrade's npm step never moves a
    # pinned package, so this entry is how it moves.
    "npm-package": {"fields": {"package": r"(@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*"}, "updates": UPDATES, "aws": False},
    # The kubectl release for the file's Kubernetes minor (dl.k8s.io).
    "kubectl": {"fields": {}, "updates": ("none", "patch"), "aws": False},
}
# Kinds that read the file's eks-kubernetes entry.
NEEDS_KUBERNETES = ("eks-addon", "eks-node-ami", "kubectl")
COMMON = {"kind", "version", "update", "note"}


def read(path):
    """The file's entries ({} when there is no file), validated."""
    if not os.path.isfile(path):
        return {}
    try:
        with open(path) as f:
            doc = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        raise BadFile(f"{path}: not readable JSON ({e})")
    validate(doc, path)
    return doc


def validate(doc, path):
    if not isinstance(doc, dict):
        raise BadFile(f"{path}: must be an object of named entries")
    problems = []
    for name, e in doc.items():
        if not isinstance(e, dict):
            problems.append(f"{name}: must be an object")
            continue
        kind = e.get("kind")
        if kind not in KINDS:
            problems.append(f"{name}: kind '{kind}' has no lookup; the kinds are {', '.join(KINDS)}")
            continue
        spec = KINDS[kind]
        pending = kind == "ec2-ami" and e.get("version") == ""
        if not pending and (not isinstance(e.get("version"), str) or not re.search(r"\d", e["version"])):
            problems.append(f"{name}: version must be a string with a number in it")
        if e.get("update") not in spec["updates"]:
            problems.append(f"{name}: update must be one of {', '.join(spec['updates'])} for {kind}")
        if "note" in e and not isinstance(e["note"], str):
            problems.append(f"{name}: note must be a string")
        if kind == "ec2-ami":
            problems += ami_problems(name, e)
        for field, pattern in spec["fields"].items():
            if pattern is None:
                continue
            if not isinstance(e.get(field), str) or not re.fullmatch(pattern, e[field]):
                problems.append(f"{name}: {field} is missing or not a valid {kind} {field}")
        extra = set(e) - COMMON - set(spec["fields"])
        if extra:
            problems.append(f"{name}: unknown field(s) {', '.join(sorted(extra))} for {kind}")
    kubes = [n for n, e in doc.items() if isinstance(e, dict) and e.get("kind") == "eks-kubernetes"]
    if len(kubes) > 1:
        problems.append(f"more than one eks-kubernetes entry ({', '.join(kubes)})")
    needing = [n for n, e in doc.items() if isinstance(e, dict) and e.get("kind") in NEEDS_KUBERNETES]
    if needing and not kubes:
        problems.append(f"{', '.join(needing)} need an eks-kubernetes entry for the Kubernetes version")
    if problems:
        raise BadFile(f"{path}:\n  " + "\n  ".join(problems))


REGION = r"[a-z]{2}(-[a-z]+)+-\d"
AMI_ID = r"ami-[0-9a-f]{8,17}"


def ami_problems(name, e):
    ids = e.get("ids")
    if not isinstance(ids, dict) or not ids:
        return [f"{name}: ids must name every region the project deploys to (region -> AMI id, \"\" to fill on update)"]
    problems = [f"{name}: ids: '{r}' is not a region" for r in ids if not re.fullmatch(REGION, r)]
    problems += [f"{name}: ids.{r}: '{i}' is not an AMI id" for r, i in ids.items() if not (i == "" or (isinstance(i, str) and re.fullmatch(AMI_ID, i)))]
    if e.get("update") == "none" and ("" in ids.values() or e.get("version") == ""):
        problems.append(f"{name}: a pinned (update none) AMI needs every region's id and its name; nothing fills them")
    return problems


# ---- version arithmetic ----

def parts(v):
    return tuple(int(n) for n in re.findall(r"\d+", v))


def shape(v):
    return re.sub(r"\d+", "N", v.lstrip("v"))


def changed_part(old, new):
    """The index of the first part that differs (0 the major), or None when equal."""
    a, b = parts(old), parts(new)
    for i in range(max(len(a), len(b))):
        if (a[i] if i < len(a) else -1) != (b[i] if i < len(b) else -1):
            return i
    return None


def newest(current, candidates, update, in_major=None):
    """The newest candidate the update allows, or `current` when none is newer. `in_major`, when
    given, says whether a candidate is in the current major (for RDS, whose major is its own
    field); otherwise the first changed part decides."""
    if update == "none":
        return current
    best = current
    for c in candidates:
        if shape(c) != shape(current) or parts(c) <= parts(best):
            continue
        if in_major is not None:
            if update != "major" and not in_major(c):
                continue
        elif changed_part(current, c) < LOWEST_PART[update]:
            continue
        best = c
    return best


def like(current, found):
    """`found` written the way `current` is (a v prefix or not)."""
    bare = found.lstrip("v")
    return f"v{bare}" if current.startswith("v") else bare


# ---- lookups (injected in tests) ----

class Sources:
    def __init__(self, region=None, attempts=3):
        self.region = region
        self.attempts = attempts

    def _retry(self, what, fn):
        for i in range(self.attempts):
            try:
                return fn()
            except (urllib.error.URLError, OSError, subprocess.CalledProcessError, TimeoutError) as e:
                if isinstance(e, urllib.error.HTTPError) and e.code < 500 and e.code != 429:
                    raise LookupFailed(f"{what}: HTTP {e.code}")
                if i == self.attempts - 1:
                    detail = getattr(e, "stderr", None) or e
                    raise LookupFailed(f"{what}: {str(detail).strip()}")
                time.sleep(2 ** i)

    def http(self, url, headers=None):
        """(status, body, response headers, names lowercased) of an HTTPS GET: 2xx, or 401 (a
        registry asking for a token). Any other status fails the lookup."""
        def get():
            req = urllib.request.Request(url, headers={"User-Agent": "cre-versions", **(headers or {})})
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    return r.status, r.read().decode("utf-8"), {k.lower(): v for k, v in r.headers.items()}
            except urllib.error.HTTPError as e:
                if e.code == 401:
                    return 401, "", {k.lower(): v for k, v in e.headers.items()}
                raise
        return self._retry(url, get)

    def aws(self, *args, region=None):
        """An AWS CLI call's JSON, in `region` or else $AWS_REGION."""
        region = region or self.region
        if not region:
            raise LookupFailed("AWS_REGION is not set: the EKS and RDS lookups need a region")
        cmd = ["aws", *args, "--region", region, "--output", "json"]

        def call():
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=120, check=True)
            return json.loads(out.stdout)
        return self._retry(" ".join(cmd[:3]), call)


def kubernetes_versions(src):
    doc = src.aws("eks", "describe-cluster-versions")
    return [v["clusterVersion"] for v in doc.get("clusterVersions", []) if v.get("status") == "STANDARD_SUPPORT"]


def addon_versions(src, addon, kubernetes):
    doc = src.aws("eks", "describe-addon-versions", "--addon-name", addon, "--kubernetes-version", kubernetes)
    return [v["addonVersion"] for a in doc.get("addons", []) for v in a.get("addonVersions", [])]


def node_ami_version(src, ami, kubernetes):
    name = f"/aws/service/eks/optimized-ami/{kubernetes}/{ami}/recommended/release_version"
    return src.aws("ssm", "get-parameter", "--name", name)["Parameter"]["Value"]


def rds_versions(src, engine):
    """{version: (major, status)} of every version RDS has for the engine, retired ones included,
    so a deprecated current version still has a major to stay in."""
    doc = src.aws("rds", "describe-db-engine-versions", "--engine", engine, "--include-all")
    return {v["EngineVersion"]: (v["MajorEngineVersion"], v.get("Status", "available")) for v in doc.get("DBEngineVersions", [])}


def helm_versions(src, repo, chart):
    """The versions of `chart` in the repo's index.yaml: the `version:` keys of the chart's own list
    items (not those of their dependencies, which sit deeper)."""
    _status, body, _ = src.http(repo.rstrip("/") + "/index.yaml")
    found, inside, key_indent = [], False, None
    for line in body.splitlines():
        if line.rstrip() == f"  {chart}:":
            inside = True
            continue
        if not inside:
            continue
        indent = len(line) - len(line.lstrip(" "))
        stripped = line.strip()
        if stripped and indent <= 2 and not stripped.startswith("- "):
            break   # the next chart
        if stripped.startswith("- ") and key_indent is None:
            key_indent = indent + 2
        m = re.match(r"^(\s*)(?:- )?version:\s*['\"]?([^'\"\s]+)", line)
        if m and key_indent is not None and len(line) - len(line.lstrip(" -")) == key_indent:
            found.append(m.group(2))
    if not found:
        raise LookupFailed(f"{repo}: no chart named {chart} in its index.yaml")
    return found


REGISTRY_HOSTS = {"docker.io": "registry-1.docker.io"}


def image_tags(src, image):
    """Every tag of an image, through the OCI distribution API, with an anonymous pull token when
    the registry answers 401 (its WWW-Authenticate header names the token service)."""
    host, repo = image.split("/", 1)
    host = REGISTRY_HOSTS.get(host, host)
    url = f"https://{host}/v2/{repo}/tags/list?n=1000"
    headers, tags = {}, []
    while url:
        status, body, resp = src.http(url, headers)
        if status == 401:
            if headers:
                raise LookupFailed(f"{image}: the registry refused its own anonymous token")
            headers = {"Authorization": f"Bearer {registry_token(src, repo, resp)}"}
            continue
        tags += json.loads(body).get("tags") or []
        link = resp.get("link", "")
        m = re.search(r'<([^>]+)>;\s*rel="?next"?', link)
        url = urllib.parse.urljoin(f"https://{host}", m.group(1)) if m else None
    return tags


def registry_token(src, repo, resp):
    challenge = resp.get("www-authenticate", "")
    params = dict(re.findall(r'(\w+)="([^"]*)"', challenge))
    if not challenge.lower().startswith("bearer") or "realm" not in params:
        raise LookupFailed(f"{repo}: the registry wants a login this can't get anonymously ({challenge or 'no WWW-Authenticate'})")
    query = {"scope": f"repository:{repo}:pull"}
    if "service" in params:
        query["service"] = params["service"]
    _status, body, _ = src.http(params["realm"] + "?" + urllib.parse.urlencode(query))
    doc = json.loads(body)
    return doc.get("token") or doc.get("access_token")


def github_tags(src, repo):
    headers = {"Accept": "application/vnd.github+json"}
    if os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['GITHUB_TOKEN']}"
    _status, body, _ = src.http(f"https://api.github.com/repos/{repo}/releases?per_page=100", headers)
    return [r["tag_name"] for r in json.loads(body) if not r.get("draft") and not r.get("prerelease")]


def tag_commit(src, repo, tag):
    """The commit a tag of `repo` points to."""
    headers = {"Accept": "application/vnd.github+json"}
    if os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['GITHUB_TOKEN']}"
    _status, body, _ = src.http(f"https://api.github.com/repos/{repo}/commits/{urllib.parse.quote(tag)}", headers)
    return json.loads(body)["sha"]


def npm_versions(src, package):
    """A package's published versions, without deprecated ones (shape() leaves prereleases out)."""
    _status, body, _ = src.http(f"https://registry.npmjs.org/{package.replace('/', '%2F')}",
                                {"Accept": "application/vnd.npm.install-v1+json"})
    return [v for v, meta in json.loads(body).get("versions", {}).items() if not meta.get("deprecated")]


def kubectl_version(src, kubernetes):
    _status, body, _ = src.http(f"https://dl.k8s.io/release/stable-{kubernetes}.txt")
    return body.strip()


def ami(src, parameter, regions):
    """(name, {region: id}): the parameter's AMI in each region, named from the first region's."""
    ids = {r: src.aws("ssm", "get-parameter", "--name", parameter, region=r)["Parameter"]["Value"] for r in sorted(regions)}
    first = sorted(regions)[0]
    images = src.aws("ec2", "describe-images", "--image-ids", ids[first], region=first).get("Images") or []
    if not images:
        raise LookupFailed(f"{parameter}: {ids[first]} in {first} has no image")
    return images[0]["Name"], ids


def minor_of(version):
    p = parts(version)
    return f"{p[0]}.{p[1]}"


def resolve(name, e, kubernetes, src):
    """The newest version entry `e` may move to."""
    kind, cur, upd = e["kind"], e["version"], e["update"]
    if upd == "none":
        return cur
    if kind == "eks-kubernetes":
        return newest(cur, kubernetes_versions(src), upd)
    if kind == "eks-addon":
        return newest(cur, addon_versions(src, e["addon"], kubernetes), upd)
    if kind == "eks-node-ami":
        found = node_ami_version(src, e["ami"], kubernetes)
        # The recommended release for the cluster's Kubernetes: a new Kubernetes minor moves it too.
        return found if parts(found) > parts(cur) or minor_of(found) != minor_of(cur) else cur
    if kind == "rds-engine":
        versions = rds_versions(src, e["engine"])
        if cur not in versions:
            raise LookupFailed(f"{name}: RDS has no {e['engine']} version {cur}")
        major = versions[cur][0]
        available = [v for v, (_m, status) in versions.items() if status == "available"]
        return newest(cur, available, upd, in_major=lambda c: versions[c][0] == major)
    if kind == "helm-chart":
        return newest(cur, helm_versions(src, e["repo"], e["chart"]), upd)
    if kind == "container-image":
        return newest(cur, image_tags(src, e["image"]), upd)
    if kind in ("github-release", "github-action"):
        tags = github_tags(src, e["repo"])
        return like(cur, newest(cur.lstrip("v"), [t.lstrip("v") for t in tags], upd))
    if kind == "npm-package":
        return newest(cur, npm_versions(src, e["package"]), upd)
    if kind == "kubectl":
        found = like(cur, kubectl_version(src, kubernetes))
        return found if parts(found) > parts(cur) or minor_of(found) != minor_of(cur) else cur
    raise BadFile(f"{name}: kind {kind}")   # validate() refuses it first


def update(path, src):
    """Resolve every entry, then write the file once. Returns [(name, old, new)] of the version
    changes (an ec2-ami entry's whose ids changed counts, even with the same name)."""
    doc = read(path)
    if not doc:
        print(f"No entries in {path}: nothing to update.")
        return []
    order = sorted(doc, key=lambda n: doc[n]["kind"] != "eks-kubernetes")
    kubernetes, changes = None, []
    for name in order:
        e = doc[name]
        fields = {}
        if e["kind"] == "ec2-ami":
            if e["update"] == "patch":
                new, ids = ami(src, e["parameter"], e["ids"])
                if ids != e["ids"]:
                    fields["ids"] = ids
            else:
                new = e["version"]
        else:
            new = resolve(name, e, kubernetes, src)
        if e["kind"] == "eks-kubernetes":
            kubernetes = new
        if new != e["version"]:
            fields["version"] = new
        if e["kind"] == "github-action" and (new != e["version"] or not e["sha"]):
            fields["sha"] = tag_commit(src, e["repo"], new)
        if fields:
            changes.append((name, e["version"], new, fields))
        print(f"  {name} ({e['kind']}, update {e['update']}): {e['version'] or '(not yet resolved)'}" +
              (f" -> {new}" if new != e["version"] else " (ids updated)" if fields else " (newest allowed)"))
    if changes:
        for name, _old, _new, fields in changes:
            doc[name].update(fields)
        with open(path, "w") as f:
            json.dump(doc, f, indent=2)
            f.write("\n")
    print(f"{len(changes)} version(s) updated in {path}." if changes else f"{path}: every version is the newest its update allows.")
    return [c[:3] for c in changes]


SSM_AMI = "AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>"


def custom_ami(template, nodegroup):
    """Whether a node group's launch template sets its own AMI (then EKS's release version doesn't
    apply). A launch template this can't find in the template counts as one: not ours to judge."""
    lt = nodegroup.get("LaunchTemplate")
    if not lt:
        return False
    ref = lt.get("Id") or lt.get("Name")
    target = ref.get("Ref") if isinstance(ref, dict) else None
    res = (template.get("Resources") or {}).get(target or "")
    if not res:
        return True
    return "ImageId" in ((res.get("Properties") or {}).get("LaunchTemplateData") or {})


def template_problems(root):
    """What in the synthesized templates under `root` sets a version outside the version file."""
    problems = []
    for dirpath, _dirs, files in os.walk(root):
        for f in sorted(files):
            if not f.endswith(".template.json"):
                continue
            path = os.path.join(dirpath, f)
            try:
                with open(path) as fh:
                    t = json.load(fh)
            except (OSError, json.JSONDecodeError) as e:
                raise BadFile(f"{path}: not readable JSON ({e})")
            name = os.path.relpath(path, root)
            for pid, prm in (t.get("Parameters") or {}).items():
                if prm.get("Type") == SSM_AMI:
                    default = prm.get("Default", "")
                    problems.append(f"{name}: parameter {pid} reads an AMI from SSM ({default}) at every deploy; use an ec2-ami entry "
                                    "and CreVersions.machineImage()")
            for rid, r in (t.get("Resources") or {}).items():
                props, typ = r.get("Properties") or {}, r.get("Type")
                if typ == "AWS::EKS::Addon" and "AddonVersion" not in props:
                    problems.append(f"{name}: {rid} ({props.get('AddonName', 'an EKS add-on')}) has no AddonVersion, so it stays on the "
                                    "version it was created with; use an eks-addon entry and CreVersions.addon()")
                elif typ == "AWS::EKS::Nodegroup" and "ReleaseVersion" not in props and not custom_ami(t, props):
                    problems.append(f"{name}: {rid} (a managed node group) has no ReleaseVersion, so its AMI never moves; use an "
                                    "eks-node-ami entry (releaseVersion: CreVersions.version(name, 'eks-node-ami'))")
                elif typ in ("AWS::RDS::DBCluster", "AWS::RDS::DBInstance") and props.get("Engine") and "EngineVersion" not in props \
                        and "DBClusterIdentifier" not in props:
                    problems.append(f"{name}: {rid} ({props['Engine']}) has no EngineVersion; use an rds-engine entry")
    return problems


def main(argv=None):
    p = argparse.ArgumentParser(description="Check or update the project's version file.")
    p.add_argument("command", choices=("check", "update"), help="check: validate the file (no network); update: move each entry to its newest allowed version")
    p.add_argument("--file", default=DEFAULT_FILE, help=f"the version file (default {DEFAULT_FILE})")
    p.add_argument("--templates", help="check: also refuse versions the synthesized templates under this directory (cdk.out) take from elsewhere")
    args = p.parse_args(argv)
    try:
        if args.command == "check":
            doc = read(args.file)
            if args.templates:
                found = template_problems(args.templates)
                if found:
                    raise BadFile(f"versions set outside {args.file} (steering cre-versions.md):\n  " + "\n  ".join(found))
            print(f"{args.file}: {len(doc)} entr{'y' if len(doc) == 1 else 'ies'}, all with a lookup." if doc else f"No {args.file}: nothing to check.")
            return 0
        update(args.file, Sources(region=os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION")))
        return 0
    except BadFile as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return BAD_FILE
    except LookupFailed as e:
        print(f"ERROR: a lookup failed, nothing was written: {e}", file=sys.stderr)
        return LOOKUP_FAILED


if __name__ == "__main__":
    sys.exit(main())
