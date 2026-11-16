#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""teardown.py: deletes the stack and waits past the CLI waiter's hour; a failed delete, or one
that never finishes, fails loudly."""
import importlib.util
import io
import os
import subprocess
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("teardown", os.path.join(os.path.dirname(os.path.abspath(__file__)), "teardown.py"))
td = importlib.util.module_from_spec(spec)
spec.loader.exec_module(td)


class FakeCfn:
    """describe-stacks answers `statuses` in turn (None: the stack is gone)."""

    def __init__(self, statuses):
        self.statuses, self.calls = list(statuses), []

    def __call__(self, region, *args):
        self.calls.append(args)
        if args[0] == "describe-stacks":
            s = self.statuses.pop(0) if len(self.statuses) > 1 else self.statuses[0]
            if s is None:
                return subprocess.CompletedProcess(args, 255, "", "Stack with id multi-az-workshop does not exist")
            return subprocess.CompletedProcess(args, 0, s + "\n", "")
        if args[0] == "describe-stack-events":
            return subprocess.CompletedProcess(args, 0, "EKSAppTargetGroupBinding\tno response", "")
        return subprocess.CompletedProcess(args, 0, "", "")


def run(fake, polls=10_000):
    td.cfn = fake
    now = [0.0]

    def sleep(s):
        now[0] += s
    out = io.StringIO()
    with redirect_stdout(out), redirect_stderr(out):
        code = td.main([], sleep=sleep, clock=lambda: now[0])
    return code, out.getvalue(), now[0]


class Teardown(unittest.TestCase):
    def test_deletes_and_waits_past_an_hour(self):
        # 150 polls of 30 s: 75 minutes, past the CLI waiter's 60.
        fake = FakeCfn(["UPDATE_COMPLETE"] + ["DELETE_IN_PROGRESS"] * 150 + [None])
        code, out, waited = run(fake)
        self.assertEqual(code, 0, out)
        self.assertIn(("delete-stack", "--stack-name", "multi-az-workshop"), fake.calls)
        self.assertGreater(waited, 3600)

    def test_a_failed_delete_fails_loudly_with_the_failed_resources(self):
        code, out, _ = run(FakeCfn(["UPDATE_COMPLETE", "DELETE_IN_PROGRESS", "DELETE_FAILED"]))
        self.assertEqual(code, 1)
        self.assertIn("ended DELETE_FAILED", out)
        self.assertIn("EKSAppTargetGroupBinding", out)

    def test_a_delete_that_never_finishes_fails(self):
        code, out, _ = run(FakeCfn(["UPDATE_COMPLETE", "DELETE_IN_PROGRESS"]))
        self.assertEqual(code, 1)
        self.assertIn("still deleting after 3 h", out)

    def test_no_stack_is_nothing_to_delete(self):
        fake = FakeCfn([None])
        self.assertEqual(run(fake)[0], 0)
        self.assertNotIn(("delete-stack", "--stack-name", "multi-az-workshop"), fake.calls)


if __name__ == "__main__":
    unittest.main()
