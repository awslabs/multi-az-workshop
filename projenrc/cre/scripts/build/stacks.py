#!/usr/bin/env python3
"""The project's deployed stacks, against the stack plan (cre-stacks.json). Uses your AWS credentials
(the ambient ones, or --profile): the stacks there named this project's and deployed from its assets
bucket in that account. --dns-profile is the DNS account's (the same switches as setup:aws): a stack
deployed there (its `assumeRole`) is read and deleted with it.

  npx projen stacks [--profile p] [--dns-profile p]   each planned stack's status, and orphans: deployed
                                                      stacks of this project main's plan no longer has
                                                      (renamed or removed); a stack this branch adds or
                                                      removes is marked "not yet on main"
  npx projen stacks:outputs [--stack id] [--profile p] [--dns-profile p]  the deployed stacks' outputs (URLs, ids),
                                                      as `<stack> <Key>=<Value>`
  npx projen teardown [--orphans] [--stack id ...] [--profile p] [--dns-profile p] [--dry-run]
                                                      delete stacks, each once every stack that takes
                                                      its outputs (or dependsOn it) is gone, the
                                                      independent ones at once. Running it is the
                                                      decision, so it doesn't ask; --dry-run prints
                                                      what it would delete and deletes nothing.
                                                      Default: every planned stack. --orphans takes
                                                      them from main's committed plan, refuses while
                                                      this branch's plan differs from it, and deletes
                                                      the newest first; --stack with it picks orphans.

A stack is this project's when its name is the project or `<project>-…` AND its AssetsBucketName
parameter is this project's bucket in that account and region (what the deploy passes; assets.py),
so another project whose name starts with this one's is never touched. A stack with `assumeRole`
is looked for in this account first (an optional role left empty deploys it here), then, with
--dns-profile, in the DNS account, matched the same way (its AssetsBucketName is this account's
bucket); without --dns-profile it is reported and never deleted. Orphans are judged in this account.

What setup and the deploy bootstrapped stays: the assets buckets (CreAssets-<project>, made by the
deploy), the setup roles (CreSetup-<project>, CreSetupDns-<project>) and the account's shared ones.
`npx projen unbootstrap` removes those. Resources a stack retains on delete (a bucket with
RemovalPolicy RETAIN) stay.

Exit codes (the setup contract): 0 done | 10 refused (no plan, unknown stack) |
11 credentials missing or expired | 20 a deletion failed.
Last stdout line: RESULT code=<n> step=<stacks|outputs|teardown>
"""
import argparse
import json
import os
import sys

sys.dont_write_bytecode = True  # never a __pycache__ in the template clone or projenrc/cre
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import crelib  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import assets  # noqa: E402
import aws as awscli  # noqa: E402  (cresetup/, on the path through crelib: the one aws CLI runner)
import cfn  # noqa: E402

# The setup contract's codes, from the one place they are defined (review 10b F4).
OK, REFUSED, CREDENTIALS, FAILED = crelib.OK, crelib.REFUSED, crelib.CREDENTIALS, crelib.FAILED


class Stop(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code, self.msg = code, msg


say = crelib.say   # a plain line on stderr (crelib's printer)


class Aws:
    """One account's aws CLI (--profile's). run is aws.Aws's call, (code, stdout, stderr); a
    credentials lapse is exit 11 from any call."""

    def __init__(self, profile):
        self.call = awscli.Aws(profile, timeout=None).call

    def run(self, *args, region=None):
        code, out, err = self.call(*args, region=region)
        # A lapse mid-run (a teardown waits on deletes for minutes) is 11, never a failed call (20)
        # or, in a delete's wait, a DELETE_FAILED of a stack CloudFormation is still deleting (review 10f D1).
        if code != 0 and awscli.lapsed(err):
            raise Stop(CREDENTIALS, f"AWS refused the credentials during aws {' '.join(args[:3])}: "
                       f"{crelib.last_line(err, '?')}\n   Nothing was concluded from it (a stack being deleted "
                       "carries on in CloudFormation). Fix what AWS names (a --profile that doesn't exist, or credentials "
                       "to refresh), then re-run: npx projen stacks shows where each stack is.")
        return code, out, err

    def json(self, *args):
        code, out, err = self.run(*args)
        if code != 0:
            raise Stop(FAILED, f"aws {' '.join(args[:2])} failed: {crelib.last_line(err, '?')}")
        return json.loads(out or "null")

    def account(self):
        try:
            return awscli.identity(self.run)
        except cfn.Failed:
            raise Stop(CREDENTIALS, "AWS credentials missing or expired (sts get-caller-identity failed). Refresh them, or pass --profile.")

    def describe(self, region, name):
        """The stack, or None when it doesn't exist."""
        try:
            return cfn.describe(self.run, region, name)
        except cfn.Failed as e:
            raise Stop(FAILED, str(e))


# A stack's own deploy finished: anything else (in progress, rolled back, failed) means main's
# version of it isn't the one running.
DEPLOYED = {"CREATE_COMPLETE", "UPDATE_COMPLETE", "IMPORT_COMPLETE"}


def committed_plan(strict=False):
    """(stacks, ref) of cre-stacks.json as committed on origin's default branch: what the pipeline
    deploys. (None, why) when that can't be read (no origin, no such file there). A branch's working
    plan is not yet deployed, so a stack it renames is no orphan until it merges (review 10c A8).
    strict (a delete): a failed fetch refuses, never falls back to the copy fetched last, which may
    miss a stack a teammate's merge added and deployed (review 10d D2)."""
    git = crelib.git
    if git("rev-parse", "--git-dir").returncode != 0 or git("remote", "get-url", "origin").returncode != 0:
        return None, "not a git checkout with an origin"
    head = git("symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD").stdout.strip() or "origin/main"
    branch = head.split("/", 1)[1] if "/" in head else "main"
    if git("fetch", "-q", "origin", f"+refs/heads/{branch}:refs/remotes/origin/{branch}").returncode != 0:
        if strict:
            raise Stop(REFUSED, f"Could not fetch origin/{branch}, so main's current stack plan is unknown and nothing is judged an "
                       "orphan from an older copy. Refresh your git credentials (GitLab: mwinit -f -k ~/.ssh/id_ecdsa.pub), then re-run.")
        say(f"⚠️  Could not fetch origin/{branch}; using the copy fetched last.")
    r = git("show", f"{head}:cre-stacks.json")
    if r.returncode != 0:
        return None, f"{head} has no cre-stacks.json ({crelib.last_line(r.stderr, '?')})"
    try:
        return json.loads(r.stdout).get("stacks", []), head
    except ValueError as e:
        return None, f"{head}:cre-stacks.json isn't valid JSON ({e})"


def not_in_plan(stacks, ids, extra=""):
    """The refusal for --stack ids the plan doesn't have, naming the ones it does: `--stack edge`
    was refused as "Not in the plan: edge." without saying that ids are `<project>-edge` (review 10f A6)."""
    have = [s["id"] for s in stacks]
    named = [next((f"{i} (did you mean {h}?)" for h in have if h.endswith(f"-{i}")), i) for i in sorted(ids)]
    return Stop(REFUSED, f"Not in the plan: {', '.join(named)}{extra}. --stack takes the full stack id; the plan has "
                f"{', '.join(have) or 'no stacks'}.")


def keys(stacks):
    return {(s["id"], s["region"]) for s in stacks}


def context(args):
    if not os.path.isfile("cre-stacks.json"):
        raise Stop(REFUSED, "No cre-stacks.json here; run from the project root (npx projen runs there).")
    try:
        stacks = crelib.read_plan()
    except crelib.BadFile as e:
        raise Stop(REFUSED, f"{e}.")
    project = os.environ.get("PROJECT_NAME")
    if not project:
        raise Stop(REFUSED, "PROJECT_NAME is not set: run it as npx projen stacks (the project's tasks set it).")
    aws = Aws(args.profile)
    account, arn = aws.account()
    known = [s["region"] for s in stacks]
    partition = crelib.partition_of(known[0]) if known else "aws"
    regions = list(dict.fromkeys(known + crelib.control_plane_regions(partition)))
    args.dns = None
    if getattr(args, "dns_profile", ""):
        args.dns = Aws(args.dns_profile)
        if args.dns.account()[0] == account:
            raise Stop(REFUSED, "--dns-profile is the app account's: leave it out (a stack there needs no other credentials).")
    return stacks, project, aws, regions, account


def is_ours(stack, project, region, account, planned=()):
    """Named like this project's stacks, and deployed from its assets bucket in this account
    (assets.py's name): another project's `demo-two` beside `demo` is never an orphan of `demo`. A
    REVIEW_IN_PROGRESS shell (a failed first create) has no parameters: matched when it is one of the
    planned stacks."""
    name = stack["StackName"]
    if name != project and not name.startswith(project + "-"):
        return False
    if stack.get("StackStatus") == "REVIEW_IN_PROGRESS" and not stack.get("Parameters"):
        return name in planned
    params = {p["ParameterKey"]: p.get("ParameterValue") for p in stack.get("Parameters", [])}
    return params.get("AssetsBucketName") == assets.bucket_name(project, account, region)


def project_stacks(aws, regions, project, account, planned=()):
    """{(name, region): stack} of every stack of this project, where orphans are looked for: the
    names from list-stacks (the runner role may list every stack), each then described by name (it
    may describe only `<project>` and `<project>-*`) to tell it from another project's. The planned
    stacks are deleted by name, never looked for."""
    out = {}
    for region in regions:
        token, names = None, []
        while True:
            args = ["cloudformation", "list-stacks", "--region", region]
            if token:
                args += ["--next-token", token]
            d = aws.json(*args)
            names += [x["StackName"] for x in d.get("StackSummaries", []) if x.get("StackStatus") != "DELETE_COMPLETE"
                      and (x["StackName"] == project or x["StackName"].startswith(project + "-"))]
            token = d.get("NextToken")
            if not token:
                break
        for name in names:
            st = aws.describe(region, name)
            if st and is_ours(st, project, region, account, planned):
                out[(name, region)] = st
    return out


def client_for(args, s, aws):
    """Who deletes a planned stack: the DNS account's credentials for one deployed there (assumeRole)
    when --dns-profile gave them; without them, this account's when the role is optional (left empty,
    it deployed here) and None (skipped) when it is required; else this account's."""
    role = s.get("assumeRole")
    if not role:
        return aws
    if args.dns:
        return args.dns
    return aws if isinstance(role, dict) and role.get("optional") else None


def cmd_status(args):
    stacks, project, aws, regions, account = context(args)
    main_stacks, ref = committed_plan()
    if main_stacks is None:
        say(f"⚠️  {ref}: orphans are judged from this checkout's plan, which may not be what main deploys.")
        main_stacks, ref = stacks, ""
    # One listing gives this account's planned stacks' status and the orphans.
    found = project_stacks(aws, regions, project, account, [st["id"] for st in stacks + main_stacks])
    here, on_main = keys(stacks), keys(main_stacks)
    rows = []
    for s in stacks:
        d = found.get((s["id"], s["region"]))
        role = s.get("assumeRole") if not d else None
        notes = []
        if role and args.dns:
            d, role = args.dns.describe(s["region"], s["id"]), None
            notes.append("in the DNS account")
        if role:
            # This account's listing doesn't have it, so its status was never read: NOT_DEPLOYED stated
            # what nobody checked, and read as "missing" (review 10f D3).
            var = role.get("variable", "") if isinstance(role, dict) else str(role)
            notes.append(f"in another account ({var}): not checked from here; pass --dns-profile")
        if ref and (s["id"], s["region"]) not in on_main:
            notes.append(f"added by this branch, not yet on {ref}")
        rows.append((s["id"], s["region"], d["StackStatus"] if d else ("NOT_CHECKED" if role else "NOT_DEPLOYED"),
                     (d.get("LastUpdatedTime") or d.get("CreationTime") or "")[:19] if d else "", ", ".join(notes)))
    for s in main_stacks:
        if (s["id"], s["region"]) not in here:
            d = found.get((s["id"], s["region"]))
            rows.append((s["id"], s["region"], d["StackStatus"] if d else "NOT_DEPLOYED", "",
                         f"removed by this branch, still on {ref}" + (": main's pipeline still deploys it" if d else "")))
    orphans = sorted(k for k in found if k not in on_main and k not in here)
    say(f"Account {account}, project {project}:")
    w = max([len(r[0]) for r in rows] + [len(o[0]) for o in orphans] + [5])
    for r in rows:
        say(f"  {r[0]:<{w}}  {r[1]:<14} {r[2]:<24} {r[3]}{'  (' + r[4] + ')' if r[4] else ''}")
    if not rows:
        say("  (the plan has no stacks)")
    for name, region in orphans:
        say(f"  {name:<{w}}  {region:<14} {found[(name, region)]['StackStatus']:<24} ORPHAN: deployed, in neither main's plan nor this one")
    if orphans:
        say("Orphans keep running (and costing) until deleted: npx projen teardown --orphans  (--dry-run lists them first).")
    for name, region in orphans:
        print(f"ORPHAN={name}@{region}")
    return OK


def cmd_outputs(args):
    stacks, project, aws, regions, account = context(args)
    want = set(args.stack or [])
    unknown = want - {s["id"] for s in stacks}
    if unknown:
        raise not_in_plan(stacks, unknown)
    n = 0
    for s in stacks:
        if want and s["id"] not in want:
            continue
        d = aws.describe(s["region"], s["id"])
        if s.get("assumeRole") and not d:
            if args.dns is None:
                say(f"{s['id']}: not in this account; pass --dns-profile to read it in the DNS account.")
                continue
            d = args.dns.describe(s["region"], s["id"])
        if not d:
            say(f"{s['id']}: not deployed.")
            continue
        for o in sorted(d.get("Outputs", []), key=lambda o: o["OutputKey"]):
            print(f"{s['id']} {o['OutputKey']}={o['OutputValue']}")
            n += 1
    say(f"{n} output(s).")
    return OK


def cmd_teardown(args):
    stacks, project, aws, regions, account = context(args)
    planned_ids = [s["id"] for s in stacks]
    # With --orphans, --stack picks orphans (one out of several, review 10g A3); alone, planned stacks.
    unknown = set(args.stack or []) - set(planned_ids) if not args.orphans else set()
    if unknown:
        raise not_in_plan(stacks, unknown, " (an orphan: --orphans --stack <id>)")
    if args.stack and not args.orphans:
        # Stacks pass values as outputs -> parameters, not exports, so CloudFormation doesn't stop the
        # delete of a stack whose outputs another planned stack takes: refuse it here (review 10b D9).
        chosen = set(args.stack)
        users = {s["id"]: [o["id"] for o in stacks if s["id"] in (o.get("needs") or []) and o["id"] not in chosen]
                 for s in stacks if s["id"] in chosen}
        blocked = {k: v for k, v in users.items() if v}
        if blocked:
            raise Stop(REFUSED, "Used by other stacks: " + "; ".join(f"{k} (by {', '.join(v)})" for k, v in blocked.items())
                       + ". Delete those too (add them with --stack), or run teardown without --stack.")
    targets, skipped = [], []
    # Why teardown would refuse now. A real run refuses before deleting anything; --dry-run still
    # lists what it would delete, then says why it won't yet (exit 10) (review 10g A1).
    refusal = ""
    if args.orphans:
        targets, refusal = orphan_targets(args, stacks, project, aws, regions, account)
    else:
        # The planned stacks, by name: a delete of one that isn't there is a no-op, so nothing is
        # looked up first. The reverse of the deploy order: dependents first.
        for s in reversed(stacks):
            if args.stack and s["id"] not in args.stack:
                continue
            client = client_for(args, s, aws)
            if client is None:
                skipped.append(s["id"])
            else:
                targets.append((s["id"], s["region"], client, ""))
    for sid in skipped:
        say(f"Skipping {sid}: it is deployed in the DNS account (assumeRole). Pass --dns-profile <that account's profile> "
            "to delete it there.")
    if refusal and not args.dry_run:
        raise Stop(REFUSED, refusal)
    # Each stack after every stack that takes its outputs or dependsOn it (planned stacks: their
    # `needs`); orphans one at a time, newest first (no plan says what they need). review 10i H5.
    if args.orphans:
        rounds = [[x] for x in targets]
    else:
        needs = {s["id"]: set(s.get("needs") or []) for s in stacks}
        rounds, left = [], list(targets)
        while left:
            ready = [x for x in left if not any(x[0] in needs.get(o[0], ()) for o in left if o is not x)] or left[:1]
            rounds.append(ready)
            left = [x for x in left if x not in ready]
    if not targets:
        say("Nothing to delete.")
    else:
        say(f"Account {account}: {'would delete' if args.dry_run else 'deleting'}, in this order (the same number at once):")
        for i, batch in enumerate(rounds, 1):
            for name, region, client, status in batch:
                where = ", ".join(x for x in (region, status, "DNS account" if client is args.dns else "") if x)
                say(f"  {i}. {name} ({where})")
    if args.dry_run:
        if targets:
            say("(dry run) Nothing was deleted. A stack that isn't deployed is skipped; their resources go too when deleted, "
                "except what a stack retains; the assets buckets and setup roles stay (npx projen unbootstrap removes them).")
        if refusal:
            raise Stop(REFUSED, f"A real run would refuse now: {refusal}")
        return OK
    if not targets:
        return OK
    failed = []
    for batch in rounds:
        say("Deleting " + ", ".join(f"{name} ({region})" for name, region, _, _ in batch) + "...")
        for (name, _, _, _), why in zip(batch, crelib.parallel(lambda x: cfn.delete(x[2].run, x[1], x[0]), batch)):
            if why:
                failed.append(f"{name}: {why}")
                say(f"  ❌ {name}: {why}")
            else:
                say(f"  ✅ {name} deleted (or wasn't there)")
        if failed and not args.orphans:
            break   # a dependent left in place blocks the stacks it needs

    if failed:
        raise Stop(FAILED, "Not deleted: " + "; ".join(failed) + ". Fix the resource named, then re-run (deleted stacks are skipped).")
    return OK


def orphan_targets(args, stacks, project, aws, regions, account):
    """(the orphans to delete, why a real run would refuse ("" when it wouldn't)): this project's
    stacks (by name) that main's committed plan doesn't have, newest first."""
    refusal = ""
    main_stacks, ref = committed_plan(strict=True)
    found = project_stacks(aws, regions, project, account, [s["id"] for s in stacks + (main_stacks or [])])
    if main_stacks is None:
        # Judging orphans from the checkout's own plan deleted, on a branch that renamed a stack,
        # the old stack main still deploys (review 10g D2): only a dry run lists them that way.
        refusal = (f"{ref}, so which stacks main no longer deploys can't be told and none are deleted. Fix that (an "
                   "origin whose default branch has cre-stacks.json committed), or delete planned stacks with --stack.")
        main_stacks, ref = stacks, "this checkout's plan"
    elif keys(main_stacks) != keys(stacks):
        added = sorted(f"{i}@{r}" for i, r in keys(stacks) - keys(main_stacks))
        removed = sorted(f"{i}@{r}" for i, r in keys(main_stacks) - keys(stacks))
        refusal = (f"This checkout's stack plan differs from {ref}'s (" + "; ".join(
            x for x in (f"adds {', '.join(added)}" if added else "", f"removes {', '.join(removed)}" if removed else "") if x)
            + "). Orphans are what main no longer deploys: merge and deploy this change first, then run teardown --orphans.")
    # A stack main renamed is an orphan only once main's own stacks are deployed: after a merge
    # whose deploy failed or is still running, the old copy is what the deployed stacks still use
    # (review 10d D1). A stack in another account can't be seen from here, so it isn't counted.
    undeployed = [f"{s['id']}@{s['region']} ({found[(s['id'], s['region'])]['StackStatus'] if (s['id'], s['region']) in found else 'not deployed'})"
                  for s in main_stacks if not s.get("assumeRole")
                  and found.get((s["id"], s["region"]), {}).get("StackStatus") not in DEPLOYED]
    if undeployed and not refusal:
        refusal = (f"The stacks of {ref} aren't all deployed yet: {', '.join(undeployed)}. Its deploy failed or is still "
                   "running, and until it finishes an old stack may still be in use. Deploy main first (follow it with npx "
                   "projen watch, or retry it with npx projen ci:rerun), then run teardown --orphans.")
    # A renamed stack's replacement is created after it, so newest first deletes dependents first.
    orphans = sorted((k for k in found if k not in keys(main_stacks)), key=lambda k: str(found[k].get("CreationTime", "")), reverse=True)
    if args.stack:
        missing = sorted(set(args.stack) - {k[0] for k in orphans})
        if missing:
            raise Stop(REFUSED, f"Not orphans: {', '.join(missing)}. The orphans are: "
                       + (", ".join(f"{n} ({r})" for n, r in orphans) or "none") + ". Nothing was deleted.")
        orphans = [k for k in orphans if k[0] in args.stack]
    return [(n, r, aws, found[(n, r)]["StackStatus"]) for n, r in orphans], refusal


USAGE = {"status": "npx projen stacks [--profile p] [--dns-profile p]",
         "outputs": "npx projen stacks:outputs [--stack id ...] [--profile p] [--dns-profile p]",
         "teardown": "npx projen teardown [--orphans] [--stack id ...] [--profile p] [--dns-profile p] [--dry-run]"}


def main(argv):
    # One parser per command: a switch a command doesn't use (`stacks --dry-run`) is refused, not ignored.
    command = argv[0] if argv and argv[0] in ("status", "outputs", "teardown") else ""
    step = {"status": "stacks", "outputs": "outputs", "teardown": "teardown"}.get(command, "stacks")
    p = crelib.ExitParser(prog=f"npx projen {({'status': 'stacks', 'outputs': 'stacks:outputs'}).get(command, command or 'stacks')}",
                          usage=USAGE.get(command, USAGE["status"]), result=f"step={step}")
    p.add_argument("command", choices=["status", "outputs", "teardown"], help=argparse.SUPPRESS)
    p.add_argument("--profile", default=os.environ.get("AWS_PROFILE", ""), help="the AWS profile (default: $AWS_PROFILE or the default credentials)")
    p.add_argument("--dns-profile", dest="dns_profile", default="", help="the DNS account's profile: a stack deployed there (its assumeRole)")
    if command in ("outputs", "teardown"):
        p.add_argument("--stack", action="append", help="only this stack (repeatable); with --orphans, only this orphan" if command == "teardown" else "only this stack (repeatable)")
    if command == "teardown":
        p.add_argument("--orphans", action="store_true", help="only the stacks main's plan no longer has, newest first")
        p.add_argument("--dry-run", dest="dry_run", action="store_true", help="print what would be deleted, in order, and delete nothing")
    args = p.parse_args(argv)
    for k in ("stack", "orphans", "dry_run"):
        if not hasattr(args, k):
            setattr(args, k, None if k == "stack" else False)
    step = {"status": "stacks", "outputs": "outputs", "teardown": "teardown"}[args.command]
    try:
        code = {"status": cmd_status, "outputs": cmd_outputs, "teardown": cmd_teardown}[args.command](args)
    except Stop as s:
        say(f"❌ {s.msg}")
        code = s.code
    print(f"RESULT code={code} step={step}", flush=True)
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
