#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""destroy:workshop — delete the workshop stack and wait until it is gone
(npx projen destroy:workshop [--region <r>] [--stack <name>]).

The deploy workflow runs it after every deploy from main (unless dispatched with `keep`), and the
teardown workflow runs it by hand and weekly, so a stack never lives long enough to age into
out-of-SLA findings. The delete takes over an hour (the EKS and observability nested stacks; the
kubectl Lambda's network interfaces are released by Lambda itself, which only makes it slower), so
this waits up to 3 hours instead of the CLI waiter's one.

Exit 0 deleted (or there was nothing to delete) | 1 the stack didn't reach DELETE_COMPLETE (its
status and failed resources are printed).
"""
import argparse
import subprocess
import sys
import time

sys.dont_write_bytecode = True

WAIT_SECONDS = 3 * 3600
POLL = 30


def cfn(region, *args):
    return subprocess.run(["aws", "cloudformation", *args, "--region", region, "--output", "text"], capture_output=True, text=True)


def status(region, stack):
    """The stack's status, or None when it doesn't exist."""
    r = cfn(region, "describe-stacks", "--stack-name", stack, "--query", "Stacks[0].StackStatus")
    if r.returncode != 0:
        if "does not exist" in r.stderr:
            return None
        raise RuntimeError(f"describe-stacks {stack}: {r.stderr.strip()}")
    return r.stdout.strip()


def main(argv=None, sleep=time.sleep, clock=time.time):
    p = argparse.ArgumentParser(description="Delete the workshop stack and wait until it is gone.")
    p.add_argument("--region", default="us-east-2", help="the stack's region (default us-east-2)")
    p.add_argument("--stack", default="multi-az-workshop", help="the stack (default multi-az-workshop)")
    a = p.parse_args(argv)
    if status(a.region, a.stack) is None:
        print(f"{a.stack} does not exist in {a.region}: nothing to delete.")
        return 0
    print(f"→ deleting {a.stack} in {a.region}")
    r = cfn(a.region, "delete-stack", "--stack-name", a.stack)
    if r.returncode != 0:
        print(f"✗ delete-stack {a.stack}: {r.stderr.strip()}", file=sys.stderr)
        return 1
    deadline = clock() + WAIT_SECONDS
    while clock() < deadline:
        s = status(a.region, a.stack)
        if s is None:
            print(f"✓ {a.stack} deleted")
            return 0
        if s != "DELETE_IN_PROGRESS":
            failed = cfn(a.region, "describe-stack-events", "--stack-name", a.stack, "--max-items", "50", "--query",
                         "StackEvents[?ResourceStatus=='DELETE_FAILED'].[LogicalResourceId,ResourceStatusReason]")
            print(f"✗ {a.stack} ended {s}:\n{failed.stdout.strip()}", file=sys.stderr)
            return 1
        sleep(POLL)
    print(f"✗ {a.stack} still deleting after {WAIT_SECONDS // 3600} h", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
