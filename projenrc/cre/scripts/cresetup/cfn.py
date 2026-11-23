"""A CloudFormation stack's state, read and changed: the one copy for setup (account.py,
unbootstrap.py) and the build scripts (deploy-stack.py, assets.py, stacks.py, deploy-local.py).

Every function takes `call`: call(*args, region=None) -> (exit code, stdout, stderr), the aws CLI
with JSON output: aws.Aws(...).call (its Reply is that tuple), or a test's fake.

  describe(call, region, name) / status(...)   the stack, None / "" when it doesn't exist
  busy(status)                                 another operation runs on it
  failed_events(call, region, name, since=)    its failed resources, newest first
  delete(call, region, name)                   delete and wait: "" when gone, else why not
  clear_failed_create(call, region, name, st, say)   a failed first create deleted, so a deploy can create it again
  deploy_stack(aws, name, template, region, say, parameters={})   setup's stacks, through `aws cloudformation deploy`
  outputs(aws, name, region) -> {OutputKey: OutputValue}   (outputs_of(stack): a described stack's)

A failure raises result.Failed: 11 when AWS refused the credentials, else 20.
"""
import json
import time

import proc
from aws import lapsed
from result import CREDS, FAILED, OK, REFUSED, Failed, must  # noqa: F401 (account.py reads them here)

# A first create that failed: CloudFormation can only delete the stack. It never existed
# successfully, so deleting it loses nothing (`cdk deploy` does the same). A delete that failed
# (a teardown that doesn't wait, then a stack still in use when it ran) is treated the same: someone
# already asked to delete it, and CloudFormation can't update it, only delete it again.
FIRST_CREATE_FAILED = ("ROLLBACK_COMPLETE", "ROLLBACK_FAILED", "DELETE_FAILED")


def failure(err, what, code):
    """The Failed a failed call means: 11 when AWS refused the credentials, else 20."""
    return Failed(CREDS if lapsed(err) else FAILED, f"{what}: {proc.last_line(err, f'exit {code}')}")


def describe(call, region, name):
    """The stack's describe-stacks record, None when it doesn't exist. Any other failure is Failed:
    read as "absent", it would create a stack that exists, or delete nothing and say done."""
    code, out, err = call("cloudformation", "describe-stacks", "--stack-name", name, region=region)
    if code == 0:
        return json.loads(out)["Stacks"][0]
    if "does not exist" in err:
        return None
    raise failure(err, f"describe-stacks {name} ({region}) failed", code)


def status(call, region, name):
    """The stack's status, "" when it doesn't exist."""
    s = describe(call, region, name)
    return s["StackStatus"] if s else ""


def busy(st):
    """Another operation runs on the stack (REVIEW_IN_PROGRESS is a change set's shell, not one)."""
    return st.endswith("_IN_PROGRESS") and st != "REVIEW_IN_PROGRESS"


def failed_events(call, region, name, limit=5, since=None):
    """The stack's failed resource events, newest first, as `<resource> <status>: <reason>`; only
    those at or after `since` (epoch seconds) when given. [] when there are none or they can't be
    read (only ever said alongside a failure that is reported anyway)."""
    code, out, _ = call("cloudformation", "describe-stack-events", "--stack-name", name, "--max-items", "100", region=region)
    if code:
        return []
    stamp = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(since - 1)) if since else ""
    evs = [e for e in json.loads(out or "{}").get("StackEvents", [])
           if e.get("ResourceStatus", "").endswith("FAILED") and e.get("Timestamp", "") >= stamp]
    return [f"{e['LogicalResourceId']} {e['ResourceStatus']}: {e.get('ResourceStatusReason', '')}" for e in evs[:limit]]


# The CLI's delete waiter gives up after 1 hour (120 polls, 30 s apart) while CloudFormation keeps
# deleting; a stack with an EKS cluster and a database takes longer. Wait up to this many of them.
DELETE_WAITS = 3


def delete(call, region, name, wait=True):
    """Delete the stack and, with wait, wait until it is gone (up to DELETE_WAITS hours). "" when it
    is (without wait: once CloudFormation accepted the delete; a stack already deleting or gone is
    accepted too), else why not: the failing call's own words (the waiter's say whether it hit
    DELETE_FAILED or gave up while CloudFormation still deletes, review 10f D1), then the resources
    that failed."""
    code, _, err = call("cloudformation", "delete-stack", "--stack-name", name, region=region)
    if code:
        return proc.last_line(err, "delete-stack failed")
    if not wait:
        return ""
    for _ in range(DELETE_WAITS):
        code, _, err = call("cloudformation", "wait", "stack-delete-complete", "--stack-name", name, region=region)
        if not code:
            return ""
        if "Max attempts exceeded" not in err:
            break   # DELETE_FAILED, or the credentials ran out: say why
    return "; ".join([proc.last_line(err, "wait stack-delete-complete failed")] + failed_events(call, region, name))


def clear_failed_create(call, region, name, st, say):
    """A stack left by a failed first create is deleted (and waited for), so the deploy can create
    it again: returns "" then, else `st` unchanged. Failed when the delete fails."""
    if st not in FIRST_CREATE_FAILED:
        return st
    left = "a delete that failed (a teardown)" if st == "DELETE_FAILED" else "a failed first create"
    say(f"Stack {name} ({region}) is {st}, left by {left}; deleting it before creating it again.")
    why = delete(call, region, name)
    if why:
        raise Failed(CREDS if lapsed(why) else FAILED, f"Could not delete {name} ({region}), left by {left}: {why}")
    return ""


# ---- setup's stacks --------------------------------------------------------------------------------
# Deployed through `aws cloudformation deploy`: a change set, created, waited for, executed and
# waited for. "No changes" is recognised by the CLI's output, the only place it is.

def deploy_stack(aws, name, template, region, say, parameters=None):
    st = clear_failed_create(aws.call, region, name, status(aws.call, region, name), say)
    if st == "UPDATE_ROLLBACK_FAILED":
        recover(aws, name, region, say)
    say(f"→  deploy stack {name}")
    start = time.time()
    r = aws.call("cloudformation", "deploy", "--stack-name", name, "--template-file", template,
                 "--capabilities", "CAPABILITY_IAM", "CAPABILITY_NAMED_IAM", "--no-fail-on-empty-changeset",
                 *(["--parameter-overrides", *(f"{k}={v}" for k, v in parameters.items())] if parameters else []),
                 region=region)
    if not r.ok:
        raise Failed(CREDS if r.kind == "creds" else FAILED, f"Deploying stack {name}: {reasons(aws, name, region, start) or r.message}")
    say(f"✓  stack {name}: " + ("no changes" if "No changes to deploy" in str(r.data) else "deployed"))


def recover(aws, name, region, say):
    """A rollback that failed: skip the shared-resource custom resources that failed it. They never
    delete anything, so skipping them is safe; any other resource fails with AWS's own error."""
    res = must(aws.call("cloudformation", "describe-stack-resources", "--stack-name", name, region=region),
               f"Reading stack {name}'s resources")["StackResources"]
    skip = [x["LogicalResourceId"] for x in res
            if x["ResourceType"] == "AWS::CloudFormation::CustomResource" and x["ResourceStatus"] == "UPDATE_FAILED"]
    say(f"→  finish stack {name}'s failed rollback" + (f", skipping {', '.join(skip)}" if skip else ""))
    start = time.time()
    must(aws.call("cloudformation", "continue-update-rollback", "--stack-name", name,
                  *(["--resources-to-skip", *skip] if skip else []), region=region), f"Continuing stack {name}'s rollback")
    r = aws.call("cloudformation", "wait", "stack-rollback-complete", "--stack-name", name, region=region)
    if not r.ok:
        raise Failed(CREDS if r.kind == "creds" else FAILED, f"Stack {name} didn't finish (stack-rollback-complete): "
                     f"{reasons(aws, name, region, start) or r.message}")


def reasons(aws, name, region, start):
    """The failed events of this deploy (at or after `start`), newest first."""
    return "; ".join(failed_events(aws.call, region, name, since=start))


def outputs_of(stack):
    """A described stack's outputs: {OutputKey: OutputValue}."""
    return {o["OutputKey"]: o["OutputValue"] for o in stack.get("Outputs", [])}


def outputs(aws, name, region):
    return outputs_of(describe(aws.call, region, name) or {})
