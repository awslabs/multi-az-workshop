"""The aws CLI: the one runner, and the one reading of its failures, for setup and the build scripts.

  aws = Aws(profile)                    # Aws(env=...) for a set of credentials in an environment
  r = aws.call("cloudformation", "describe-stacks", "--stack-name", s, region=r)   # -> Reply
  account, arn = identity(aws.call)

Every call runs `aws <args> --output json` (unless the args name their own --output) with no pager
or prompt and stdin closed, and with the CLI's own throttling retry (adaptive, 8 attempts) unless
the environment sets one. `timeout`: seconds per call, setup's 60 by default (a hung network call
can't stall an unattended run; a `wait` or `deploy`: WAIT_TIMEOUT); None for none (the build's
calls, which the CI job bounds).

A Reply is the tuple (code, out, err), so `code, out, err = aws.call(...)` reads it, with:
  ok        code 0
  kind      ok | creds (the credentials are missing, expired or refused) | failed (anything else,
            a timeout included)
  data      out parsed as JSON (None when it printed nothing; the text when it isn't JSON)
  message   err's last line, where AWS's error code (e.g. "NoSuchEntity") is
err is the CLI's stderr, or its stdout when a failed call printed nothing on stderr.
"""
import json
import os
from typing import NamedTuple

import proc
from constants import CREDENTIALS_LAPSED
from result import CREDS, FAILED, Failed

CALL_TIMEOUT = 60
# A stack operation's waiter (`wait`, and `deploy`, which waits for its change set) runs for as long
# as CloudFormation takes: two hours with a limit, never CALL_TIMEOUT.
WAIT_TIMEOUT = 7200
RETRY = {"AWS_RETRY_MODE": "adaptive", "AWS_MAX_ATTEMPTS": "8"}


def lapsed(text):
    """AWS refused the credentials (expired, missing, a profile that doesn't exist): the one test."""
    return bool(CREDENTIALS_LAPSED.search(text or ""))


class Reply(NamedTuple):
    code: int
    out: str = ""
    err: str = ""

    @property
    def ok(self):
        return self.code == 0

    @property
    def kind(self):
        return "ok" if self.ok else "creds" if lapsed(self.err) else "failed"

    @property
    def data(self):
        if not self.out.strip():
            return None
        try:
            return json.loads(self.out)
        except ValueError:
            return self.out.strip()

    @property
    def message(self):
        return proc.last_line(self.err, f"exit {self.code}")


def cli_env(env=None):
    """The environment every aws CLI call runs with: `env` (default: this process's), no pager or
    prompt, the retry settings unless it has its own."""
    return {**RETRY, **(os.environ if env is None else env), "AWS_PAGER": "", "AWS_CLI_AUTO_PROMPT": "off"}


class Aws:
    """One set of credentials: a profile, or `env`'s. `region` per call (IAM has none)."""

    def __init__(self, profile="", env=None, timeout=CALL_TIMEOUT, runner=proc.run):
        self.profile, self.env, self.timeout, self._run = profile, env, timeout, runner

    def call(self, *args, region=None, timeout=None):
        cmd = ["aws", *args] + ([] if "--output" in args else ["--output", "json"])
        if self.profile:
            cmd += ["--profile", self.profile]
        if region:
            cmd += ["--region", region]
        if not timeout and self.timeout:
            timeout = WAIT_TIMEOUT if args[1:2] in (("wait",), ("deploy",)) else self.timeout
        r = self._run(cmd, timeout, env=cli_env(self.env))
        return Reply(r.code, r.out, r.err.strip() or ("" if r.code == 0 else r.out.strip()))


def identity(call, region=None):
    """(account, ARN) of the credentials: the one sts get-caller-identity reader. Failed (11 when
    AWS refused the credentials, else 20) with the CLI's last line."""
    code, out, err = call("sts", "get-caller-identity", region=region)
    if code:
        raise Failed(CREDS if lapsed(err) else FAILED, f"sts get-caller-identity: {proc.last_line(err, f'exit {code}')}")
    d = json.loads(out)
    return d["Account"], d.get("Arn", "")


def partition(arn):
    """The partition an ARN names (arn:<partition>:...)."""
    return arn.split(":")[1] if arn.count(":") > 1 else ""
