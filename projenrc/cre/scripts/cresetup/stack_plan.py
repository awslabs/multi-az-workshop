"""The stack plan, cre-stacks.json (what `npx projen` writes from the CDK app): its one reader, for
setup (unbootstrap's regions, the noEcho variables) and, through crelib, the build, git and cfs
scripts.

  plan_doc(path) -> {"stacks": [...], ...}   read_plan(path) -> the stacks
  noecho_variables(keys, project_dir)       the deploy variables that feed a noEcho parameter
"""
import json
import os

from result import REFUSED, Failed


class BadFile(Exception):
    """A project file (cre-stacks.json) that exists but isn't what npx projen writes: each caller says it with its own exit, never as "empty" (review 10f G2)."""


def plan_doc(path="cre-stacks.json"):
    """cre-stacks.json as a dict whose "stacks" is a list of dicts: {"stacks": []} when the file is
    missing (no stacks yet). BadFile when it can't be read or isn't the plan: an interrupted `npx
    projen` truncates it, and reading that as "no stacks" sent cfs:onboard after a missing
    CreEdgeStack and let setup:aws skip the plan's regions. The one reader of the plan."""
    try:
        with open(path) as f:
            doc = json.load(f)
    except FileNotFoundError:
        return {"stacks": []}
    except (OSError, ValueError) as e:
        raise BadFile(f"{path} can't be read ({e}): run npx projen to write it again")
    stacks = doc.get("stacks") if isinstance(doc, dict) else None
    if not isinstance(stacks, list):
        raise BadFile(f"{path} has no list of stacks: run npx projen to write it again")
    return {**doc, "stacks": [s for s in stacks if isinstance(s, dict)]}


def read_plan(path="cre-stacks.json"):
    """cre-stacks.json's stacks (plan_doc's)."""
    return plan_doc(path)["stacks"]


def noecho_variables(keys, project_dir="."):
    """The ones of `keys` that feed a noEcho parameter of a planned stack, so setup stores them hidden
    (GitLab masked, a GitHub secret) whatever switch set them. The plan records, for each parameter a
    deploy variable feeds, whether it is noEcho (CreCfnParameter writes it). Nothing else is read: a
    synthesized template in cdk.out/ can be older than the plan (review 10j A1). No cre-stacks.json (a
    scaffold before its first build): no stack takes a variable, so none is hidden."""
    if not keys:
        return set()
    try:
        stacks = read_plan(os.path.join(project_dir, "cre-stacks.json"))
    except BadFile as e:
        raise Failed(REFUSED, f"The stack plan {e}.")
    return {src["variable"] for s in stacks for src in (s.get("parameters") or {}).values()
            if isinstance(src, dict) and src.get("kind") == "env" and src.get("variable") in keys and src.get("noEcho")}
