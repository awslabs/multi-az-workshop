#!/usr/bin/env python3
"""build:image-tags — tag every built container image by what it contains.

CDK tags an image with its asset hash, a hash of the Dockerfile and build context. That never
changes when only the OS packages inside the image do (a weekly rebuild that applied updates), so
the push skipped the existing tag and ECS never redeployed. This replaces each image's tag with

    <asset hash>-<first 16 hex of sha256(installed package list)>

read from the image's own package database (dpkg, apk or rpm, the OSes cre-project-structure.md
allows): the same packages give the same tag, so an unchanged image is neither pushed nor
redeployed, and any package change gives a new tag, a new task definition and an ECS deploy. An
image with no package database it knows (distroless, scratch) keeps the asset hash.

Runs after the images are built (assets/containers/<hash>.tar.gz) and the templates are staged
(assets/*.json): it rewrites the tag in assets/containers/manifest.json, which deploy-docker.py
pushes, and in every staged template. Re-running it changes nothing.

Exit 0 | 1 an image tarball or package database it can't read.
"""
import glob
import hashlib
import json
import os
import re
import sqlite3
import struct
import sys
import tarfile
import tempfile

ASSETS = "assets"
MANIFEST = os.path.join(ASSETS, "containers", "manifest.json")

# Package databases, by the path inside the image (no leading slash, as image layers store them).
DPKG = "var/lib/dpkg/status"
APK = "lib/apk/db/installed"
RPM_DIRS = ("var/lib/rpm", "usr/lib/sysimage/rpm")
RPM_FILES = ("rpmdb.sqlite", "rpmdb.sqlite-wal", "rpmdb.sqlite-shm")
WANTED = {DPKG, APK} | {f"{d}/{f}" for d in RPM_DIRS for f in RPM_FILES}


class Unreadable(Exception):
    pass


def layer_files(layer):
    """{path: bytes or None (deleted)} of the WANTED files one layer writes or whites out."""
    found = {}
    with tarfile.open(fileobj=layer, mode="r|*") as t:
        for m in t:
            name = m.name.lstrip("./")
            base = os.path.basename(name)
            if base.startswith(".wh."):
                gone = os.path.join(os.path.dirname(name), base[len(".wh."):])
                if gone in WANTED:
                    found[gone] = None
            elif name in WANTED and m.isfile():
                found[name] = t.extractfile(m).read()
    return found


def image_files(path):
    """The WANTED files as the image's final filesystem has them: each layer in order, the last
    write (or whiteout) winning. Reads the `docker save` / kaniko tarball (.tar.gz) in one pass."""
    layers, manifest = {}, None
    try:
        with tarfile.open(path, mode="r|gz") as outer:
            for m in outer:
                if not m.isfile():
                    continue
                f = outer.extractfile(m)
                if m.name == "manifest.json":
                    manifest = json.load(f)
                elif m.name.endswith((".tar", ".tar.gz", "/layer.tar")) or m.name.startswith("blobs/"):
                    try:
                        layers[m.name] = layer_files(f)
                    except tarfile.ReadError:
                        pass   # a config blob under blobs/, not a layer
    except (OSError, tarfile.TarError, EOFError, json.JSONDecodeError) as e:
        raise Unreadable(f"{path}: not a readable image tarball ({e})")
    if not manifest or not manifest[0].get("Layers"):
        raise Unreadable(f"{path}: the tarball has no manifest.json naming its layers")
    files = {}
    for name in manifest[0]["Layers"]:
        files.update(layers.get(name, {}))
    return {k: v for k, v in files.items() if v is not None}


def stanzas(text, sep):
    """The blank-line-separated records of a dpkg status / apk installed file, as {key: value}."""
    for block in text.split("\n\n"):
        rec = {}
        for line in block.splitlines():
            if sep in line and not line.startswith((" ", "\t")):
                k, v = line.split(sep, 1)
                rec[k] = v.strip()
        if rec:
            yield rec


def dpkg_packages(data):
    return [f"{r['Package']} {r.get('Version', '')} {r.get('Architecture', '')}"
            for r in stanzas(data.decode("utf-8", "replace"), ":")
            if "Package" in r and r.get("Status", "").endswith(" installed")]


def apk_packages(data):
    return [f"{r['P']} {r.get('V', '')} {r.get('A', '')}" for r in stanzas(data.decode("utf-8", "replace"), ":") if "P" in r]


# rpm header tags (rpmtag.h) and the types they are stored as.
NAME, VERSION, RELEASE, EPOCH, ARCH = 1000, 1001, 1002, 1003, 1022
STRING, INT32 = 6, 4


def rpm_header(blob):
    """name-epoch:version-release.arch of one rpm header blob (as rpmdb.sqlite stores it: the
    index count, the data length, the index entries, then the data, with no magic)."""
    il, dl = struct.unpack(">ii", blob[:8])
    data = blob[8 + 16 * il:8 + 16 * il + dl]
    tags = {}
    for i in range(il):
        tag, typ, off, _count = struct.unpack(">iiii", blob[8 + 16 * i:24 + 16 * i])
        if tag in (NAME, VERSION, RELEASE, ARCH) and typ == STRING:
            tags[tag] = data[off:data.index(b"\0", off)].decode("utf-8", "replace")
        elif tag == EPOCH and typ == INT32:
            tags[tag] = str(struct.unpack(">i", data[off:off + 4])[0])
    if NAME not in tags:
        return None   # rpm's own bookkeeping entries (e.g. gpg-pubkey has a name; others don't)
    epoch = f"{tags[EPOCH]}:" if EPOCH in tags else ""
    return f"{tags[NAME]} {epoch}{tags.get(VERSION, '')}-{tags.get(RELEASE, '')} {tags.get(ARCH, '')}"


def rpm_packages(files, base):
    """The packages in an rpm sqlite database (with its WAL, which holds what the last dnf
    transaction wrote until sqlite checkpoints it)."""
    with tempfile.TemporaryDirectory() as d:
        for f in RPM_FILES:
            if f"{base}/{f}" in files:
                with open(os.path.join(d, f), "wb") as out:
                    out.write(files[f"{base}/{f}"])
        try:
            con = sqlite3.connect(os.path.join(d, "rpmdb.sqlite"))
            try:
                blobs = [row[0] for row in con.execute("SELECT blob FROM Packages")]
            finally:
                con.close()
        except sqlite3.Error as e:
            raise Unreadable(f"the image's rpm database ({base}/rpmdb.sqlite) can't be read: {e}")
    return [p for p in (rpm_header(b) for b in blobs) if p]


def packages(files):
    """(database, sorted package list), or (None, []) when the image has none this knows."""
    if DPKG in files:
        return DPKG, sorted(dpkg_packages(files[DPKG]))
    if APK in files:
        return APK, sorted(apk_packages(files[APK]))
    for base in RPM_DIRS:
        if f"{base}/rpmdb.sqlite" in files:
            return f"{base}/rpmdb.sqlite", sorted(rpm_packages(files, base))
    return None, []


def content_tag(source_hash, pkgs):
    return f"{source_hash}-{hashlib.sha256(chr(10).join(pkgs).encode()).hexdigest()[:16]}"


def retag_templates(source_hash, tag):
    """Point every staged template's image URI at the new tag. Matches the asset hash only where
    nothing follows it, so a second run leaves an already-rewritten tag alone."""
    pattern = re.compile(rf":{source_hash}(?![-0-9a-f])")
    for path in sorted(glob.glob(os.path.join(ASSETS, "*.json"))):
        with open(path) as f:
            text = f.read()
        new = pattern.sub(f":{tag}", text)
        if new != text:
            with open(path, "w") as f:
                f.write(new)


def main():
    if not os.path.isfile(MANIFEST):
        print(f"No {MANIFEST}: no container images to tag.")
        return 0
    with open(MANIFEST) as f:
        images = json.load(f)
    for img in images:
        tar = os.path.join(ASSETS, "containers", f"{img['hash']}.tar.gz")
        if not os.path.isfile(tar):
            # A local build without Docker (build:docker warned): the deploy stops at the missing image.
            print(f"  {img['hash'][:12]}: not built here, tag unchanged")
            continue
        try:
            db, pkgs = packages(image_files(tar))
        except Unreadable as e:
            print(f"ERROR: image {img['hash']}: {e}", file=sys.stderr)
            return 1
        if not db:
            print(f"  {img['hash'][:12]}: no dpkg, apk or rpm database in the image; tagged by its asset hash only")
            continue
        tag = content_tag(img["hash"], pkgs)
        print(f"  {img['hash'][:12]}: {len(pkgs)} packages ({db}) → tag {tag}")
        img["tag"] = tag
        retag_templates(img["hash"], tag)
    with open(MANIFEST, "w") as f:
        json.dump(images, f, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
