#!/usr/bin/env python3
"""A Workshop Studio workshop's build steps (CreWorkshopStudio), from the repository root.

  workshop.py stage <stack>...   copy each top-level template the build staged (assets/<stack>.json) to
                                 static/<stack>.json, where contentspec.yaml points Workshop Studio
  workshop.py check              run Workshop Studio's build tool on the repository (contentspec.yaml,
                                 every page's front matter, the templates), then our template checks
                                 (what Workshop Studio's deploy or its retry would refuse)
  workshop.py preview [--port n] serve the guide at http://localhost:<port> (default 8080) as Workshop
                                 Studio renders it

  workshop.py location [--local]  print the build tool's location for this machine's platform (linux,
                                 linux_arm, osx, osx_arm, windows, windows_arm): from the CI secret for it
                                 ($BUILD_TOOL_LOCATION_<PLATFORM>), or --local from the template's
                                 laptop-only cresetup/workshop_studio.py

Workshop Studio's build tool is internal: its location is never written in the repository (it may be
public). `location` finds it, from either source, and the next step takes it as $BUILD_TOOL_LOCATION
(the tasks run `BUILD_TOOL_LOCATION="$(workshop.py location ...)" workshop.py check`): one way in,
whichever the source. Empty: `check` runs only our checks and says so. The tool is downloaded (with retries) into .cre/tools/, and again once it is
a week old: Workshop Studio updates it, and an old copy checks against old rules.
Exit 0 | 10 the workshop has problems (listed) | 20 the build tool couldn't be downloaded or run.
"""
import argparse
import json
import os
import platform
import re
import shutil
import signal
import socket
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request

sys.dont_write_bytecode = True

PROBLEMS, TOOL_FAILED = 10, 20
TOOLS = os.path.join(".cre", "tools")
LOCATION = "BUILD_TOOL_LOCATION"
# A laptop's: the template's laptop-only module (copied beside the scripts, never committed).
LOCAL_MODULE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "cresetup", "workshop_studio.py")
# Workshop Studio's limits a template has to stay inside (docs: outputs-and-exports; CloudFormation's
# own 1 MB for a template read from S3).
MAX_OUTPUTS = MAX_EXPORTS = 50
MAX_TEMPLATE_BYTES = 1_000_000
RETAIN = ("Retain", "RetainExceptOnCreate")
MAX_TOOL_AGE = 7 * 24 * 3600


def platform_key():
    """This machine's build of the tool, from its OS and CPU: linux, linux_arm, osx, osx_arm, windows or windows_arm."""
    system = {"Darwin": "osx", "Linux": "linux", "Windows": "windows"}.get(platform.system())
    if not system:
        print(f"ERROR: Workshop Studio's build tool has no build for {platform.system()}.", file=sys.stderr)
        sys.exit(TOOL_FAILED)
    return system + ("_arm" if platform.machine().lower() in ("arm64", "aarch64") else "")


def tool_location(key, local):
    """The build tool's location for platform `key`, from one of two sources: the CI secret for that
    platform ($BUILD_TOOL_LOCATION_<PLATFORM>, every platform's is in the job's environment), or with
    local=True the template's laptop-only cresetup/workshop_studio.py beside this script. "" when none.
    `workshop.py location` prints it; the next step takes it as $BUILD_TOOL_LOCATION."""
    if not local:
        return os.environ.get(f"{LOCATION}_{key.upper()}", "").strip()
    if not os.path.isfile(LOCAL_MODULE):
        return ""
    import importlib.util
    spec = importlib.util.spec_from_file_location("cre_workshop_studio_local", LOCAL_MODULE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.build_tool_location(key)


def build_tool():
    """The path to Workshop Studio's build tool, downloaded on first use from $BUILD_TOOL_LOCATION (the
    `location` step's output); None when it is empty."""
    key = platform_key()
    url = os.environ.get(LOCATION, "").strip()
    if not url:
        return None
    path = os.path.join(TOOLS, "workshop-build" + (".exe" if key.startswith("windows") else ""))
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < MAX_TOOL_AGE:
        return path
    os.makedirs(TOOLS, exist_ok=True)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=120) as r, open(path + ".part", "wb") as f:
                shutil.copyfileobj(r, f)
            break
        except (urllib.error.URLError, OSError, ValueError) as e:
            if attempt == 4:
                # Not the URL: it is a secret.
                print(f"ERROR: could not download Workshop Studio's build tool from ${LOCATION}: {e}", file=sys.stderr)
                sys.exit(TOOL_FAILED)
            time.sleep(5 * (attempt + 1))
    os.replace(path + ".part", path)
    os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR)
    return path


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def ws_build_problems(tool):
    """The errors Workshop Studio's build reports (its warnings are printed, and don't fail). The tool
    builds, starts serving, and stops when its stdin closes."""
    try:
        r = subprocess.run([tool, "-disable-refresh", "-input", ".", "-port", str(free_port())],
                           stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=300)
    except (OSError, subprocess.TimeoutExpired) as e:
        print(f"ERROR: Workshop Studio's build tool didn't run: {e}", file=sys.stderr)
        sys.exit(TOOL_FAILED)
    lines = [strip_color(l) for l in (r.stdout + r.stderr).splitlines()]
    reported = lambda level: [l.split(" ", 2)[-1] for l in lines if f" {level} " in l and "Error hosting local preview site" not in l]
    for w in reported("WRN"):
        print(f"  warning: {w}", file=sys.stderr)
    errors = reported("ERR")
    if errors or any("Build succeeded." in l or "Build complete with" in l for l in lines):
        return errors
    return ["Workshop Studio's build tool didn't report a finished build:\n" + "\n".join(lines[-20:])]


def strip_color(line):
    return re.sub(r"\x1b\[[0-9;]*m", "", line)


def template_problems(path, name):
    """What Workshop Studio's deploy, or its automatic retry in a recycled account, would refuse."""
    problems = []
    size = os.path.getsize(path)
    if size > MAX_TEMPLATE_BYTES:
        problems.append(f"{name}: {size} bytes, over CloudFormation's {MAX_TEMPLATE_BYTES} for a template: move resources into nested stacks.")
    with open(path) as f:
        t = json.load(f)
    outputs = t.get("Outputs") or {}
    if len(outputs) > MAX_OUTPUTS:
        problems.append(f"{name}: {len(outputs)} outputs; Workshop Studio allows {MAX_OUTPUTS} per template.")
    exports = [o["Export"] for o in outputs.values() if "Export" in o]
    if len(exports) > MAX_EXPORTS:
        problems.append(f"{name}: {len(exports)} exports; Workshop Studio allows {MAX_EXPORTS} per template.")
    for rid, r in (t.get("Resources") or {}).items():
        if r.get("Type") == "AWS::IAM::ServiceLinkedRole":
            problems.append(f"{name}: {rid} creates a service-linked role, which a recycled account may already have (the deploy and its "
                            "retry fail): list the service in workshopStudio.serviceLinkedRoles instead.")
        # Workshop Studio's build reports these itself for static/ templates; it never sees the nested ones.
        for policy in ("DeletionPolicy", "UpdateReplacePolicy") if not path.startswith("static" + os.sep) else ():
            if r.get(policy) in RETAIN:
                problems.append(f"{name}: {rid} has {policy}: {r[policy]}: a retained resource blocks the account's cleanup and the "
                                "automatic retry (RemovalPolicy.DESTROY).")
    return problems


def all_templates():
    """static/*.json the build staged, and every nested template in assets/."""
    # static/ also holds what isn't a template (iam_policy.json): keep only templates.
    paths = []
    for d in ("static", "assets"):
        if os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                p = os.path.join(d, f)
                if f.endswith(".json") and os.path.isfile(p) and is_template(p):
                    paths.append(p)
    return paths


def is_template(path):
    try:
        with open(path) as f:
            doc = json.load(f)
    except (OSError, ValueError):
        return False
    return isinstance(doc, dict) and "Resources" in doc


def stage(stacks):
    os.makedirs("static", exist_ok=True)
    for s in stacks:
        src = os.path.join("assets", f"{s}.json")
        if not os.path.isfile(src):
            print(f"ERROR: {src} isn't there: run package:assets first.", file=sys.stderr)
            return PROBLEMS
        shutil.copyfile(src, os.path.join("static", f"{s}.json"))
        print(f"  static/{s}.json")
    return 0


def missing_templates():
    """Templates contentspec.yaml lists that aren't there (Workshop Studio's build only warns)."""
    try:
        with open("contentspec.yaml") as f:
            spec = f.read()
    except OSError:
        return []
    # Generated, one `templateLocation: <path>` a line: no YAML parser needed.
    found = re.findall(r"^\s*-?\s*templateLocation:\s*['\"]?([^'\"\s]+)", spec, re.M)
    return [f"{t}: contentspec.yaml lists it, but it isn't there: run npx projen build (workshop:stage)." for t in found if not os.path.isfile(t)]


def check():
    tool = build_tool()
    if tool:
        problems = ws_build_problems(tool)
    else:
        problems = []
        print(f"NOTE: Workshop Studio's build tool location isn't set (${LOCATION}): its build was skipped, only our checks ran.", file=sys.stderr)
    problems += missing_templates()
    templates = all_templates()
    for p in templates:
        problems += template_problems(p, p)
    if problems:
        print("Workshop Studio's build reported errors, or a template has what a deploy would refuse:", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return PROBLEMS
    passed = "Workshop Studio's build passed; " if tool else ""
    print(f"{passed}{len(templates)} template(s) checked.")
    return 0


def preview(port):
    tool = build_tool()
    if not tool:
        print(f"ERROR: the preview needs Workshop Studio's build tool: set ${LOCATION} (ask the team for it).", file=sys.stderr)
        return TOOL_FAILED
    print(f"Serving the guide at http://localhost:{port} (Ctrl+C to stop).")
    # The tool stops when its stdin closes: a pipe only this process holds, so the server goes when
    # this process does, however it ends (Ctrl+C, a TERM from a task runner or an agent, even a KILL).
    # A plain call would leave it serving the terminal's stdin after a TERM.
    server = subprocess.Popen([tool, "-input", ".", "-port", str(port)], stdin=subprocess.PIPE)

    def stop(signum, _frame):
        server.terminate()
        raise SystemExit(128 + signum)

    for sig in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, stop)
    try:
        return server.wait()
    except KeyboardInterrupt:
        return 130
    finally:
        if server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()


def main(argv=None):
    p = argparse.ArgumentParser(description="Workshop Studio build steps for a CreWorkshopStudio project.")
    sub = p.add_subparsers(dest="command", required=True)
    st = sub.add_parser("stage", help="copy the staged top-level templates to static/")
    st.add_argument("stacks", nargs="+", help="the top-level stacks, in deploy order")
    lo = sub.add_parser("location", help="print the build tool's location for this machine's platform")
    lo.add_argument("--local", action="store_true", help="from the template's laptop-only files, not the CI secret")
    sub.add_parser("check", help="Workshop Studio's own build and our template checks ($BUILD_TOOL_LOCATION: the tool)")
    pv = sub.add_parser("preview", help="serve the guide locally")
    pv.add_argument("--port", type=int, default=8080, help="the local port (default 8080)")
    a = p.parse_args(argv)
    if a.command == "stage":
        return stage(a.stacks)
    if a.command == "location":
        print(tool_location(platform_key(), a.local))
        return 0
    if a.command == "check":
        return check()
    return preview(a.port)


if __name__ == "__main__":
    sys.exit(main())
