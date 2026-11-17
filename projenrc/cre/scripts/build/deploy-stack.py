#!/usr/bin/env python3
"""deploy:stack — deploy one CloudFormation stack from the template the `deploy:s3` task uploaded.

Always --template-url, so the 51200-byte local template body limit never applies. `aws cloudformation
deploy` has no --template-url, so this drives change sets: create-change-set → wait → execute →
poll until the stack transitions → bounded wait for the end. An empty change set is a success.

Required env:
  AWS_REGION          the stack's region; its assets bucket is in the same region
  STACK_NAME          the CloudFormation stack name
  TEMPLATE_NAME       the template's base name (no extension) under the prefix
  ASSETS_BUCKET       the region's assets bucket; when unset, named from PROJECT_NAME, the app account
                      and AWS_REGION (assets.py). The templates are always in the app account's
                      bucket, also for a stack deployed into another account: with ASSUME_ROLE the
                      app account is RUNNER_ROLE_ARN's, else the credentials' own
  ASSETS_PREFIX       the run's key prefix (a trailing / is added)

Optional env:
  STACK_PARAMETERS    the stack's parameters, one `Key=Value` per line (split on the first =; values
                      may hold commas, spaces, backslashes). Written to a JSON parameters file, so the
                      CLI's shorthand parser never sees them. AssetsBucketName / AssetsBucketPrefix
                      are always added.
  OUTPUTS_FILE        the dotenv file for the stack's outputs (default dist/$STACK_NAME.env; GitLab
                      reads it with `artifacts: reports: dotenv:`)
  OUTPUTS_PREFIX      prefix for every output's key (STACK_<ID>), so jobs' dotenvs don't collide
  OUTPUTS             space-separated output names to write (unset: every output; GitLab caps a
                      dotenv's variable count, so jobs pass only the ones later stacks take)
  ROLE_ARN            CloudFormation's service role (empty: CFN_EXECUTION_ROLE_ARN)
  ASSUME_ROLE         the role the job deploys as, when it isn't the runner role (e.g. the DNS
                      account's): CI gives the job that role's credentials directly (stack-jobs.ts)
  RUNNER_ROLE_ARN     with ASSUME_ROLE: the runner role, whose account holds the assets buckets
  REQUIRED_VARS       space-separated variables that must be non-empty
  REQUIRED_OUTPUTS    space-separated `<VAR>=<stack>/<Output>`: earlier stacks' outputs this one takes
  STACK_WAIT_SECONDS  this job's whole wait on CloudFormation (default 6000, under the 2-hour deploy
                      job timeout, so a slow stack fails here, with its events, instead of the job
                      being killed; GitLab's vended credentials end at 1 hour, and a stack still
                      running then fails as "credentials expired": a re-run waits for it). One
                      deadline covers waiting out another run and our own.
  STACK_POLL_SECONDS  default 15

Every stack job sets these from the stack plan (stack-jobs.ts); this script checks them and
deploys. It looks nothing up. Throttling is the CLI's own retry (adaptive, 8 attempts) on every
call. Exit 0 deployed (or no changes) | 1 anything else.
"""
import json
import os
import random
import re
import sys
import time

sys.dont_write_bytecode = True  # never a __pycache__ in the template clone or projenrc/cre
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import crelib  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import assets  # noqa: E402
import aws as awscli  # noqa: E402  (cresetup/, on the path through crelib: the one aws CLI runner)
import cfn  # noqa: E402


class Fail(Exception):
    """Ends the deploy (exit 1); the message (if any) is printed."""


def err(msg):
    print(msg, file=sys.stderr, flush=True)


def say(msg):
    print(msg, flush=True)


def s3_domain(region):
    # The S3 domain differs by partition (review #11): China, the European Sovereign Cloud. The
    # partition comes from crelib's one prefix table (review 10c G1).
    return {"aws-cn": "amazonaws.com.cn", "aws-eusc": "amazonaws.eu"}.get(crelib.partition_of(region), "amazonaws.com")


def preflight(env):
    """The checks before anything is deployed."""
    # An unset CI secret or variable arrives as an empty string, which would otherwise surface as a
    # CloudFormation parameter error (or a deploy as the wrong role) much later.
    for v in env.get("REQUIRED_VARS", "").split():
        if not env.get(v):
            raise Fail(f"{v} is set but EMPTY - an unset CI secret or variable arrives as an empty string. Set it and re-run.")
    for r in env.get("REQUIRED_OUTPUTS", "").split():
        var, _, what = r.partition("=")
        if var not in env:
            stack, _, output = what.partition("/")
            raise Fail(f"stack {stack} has no output {output} (needed by {env.get('STACK_NAME') or 'this stack'})")
    role_arn = env.get("ROLE_ARN") or env.get("CFN_EXECUTION_ROLE_ARN") or ""
    assume = env.get("ASSUME_ROLE", "")
    if not env.get("ASSETS_BUCKET") and env.get("AWS_REGION"):
        if not env.get("PROJECT_NAME"):
            raise Fail("PROJECT_NAME is required (the assets bucket is named from it)")
        if assume and not crelib.account_of(env.get("RUNNER_ROLE_ARN", "")):
            raise Fail("RUNNER_ROLE_ARN is required with ASSUME_ROLE: the assets bucket is in the runner role's account")
        try:
            app_account = crelib.account_of(env["RUNNER_ROLE_ARN"]) if assume else assets.account()
            env["ASSETS_BUCKET"] = assets.bucket_name(env["PROJECT_NAME"], app_account, env["AWS_REGION"])
        except assets.Fail as e:
            raise Fail(str(e))
    for k in ("AWS_REGION", "STACK_NAME", "TEMPLATE_NAME", "ASSETS_BUCKET", "ASSETS_PREFIX"):
        if not env.get(k):
            raise Fail(f"{k} is required")
    return role_arn


class Deploy:
    def __init__(self, env, role_arn):
        self.env = env
        self.region = env["AWS_REGION"]
        self.stack = env["STACK_NAME"]
        self.role_arn = role_arn
        self.prefix = env["ASSETS_PREFIX"].rstrip("/") + "/"
        self.bucket = env["ASSETS_BUCKET"]
        self.poll = float(env.get("STACK_POLL_SECONDS") or 15)
        # One deadline for every wait in this job: two separate 6000 s waits outlived the job timeout
        # and the credentials (review 10b D3).
        self.deadline = time.time() + float(env.get("STACK_WAIT_SECONDS") or 6000)
        self.url = (f"https://{self.bucket}.s3.{self.region}.{s3_domain(self.region)}/{self.prefix}"
                    f"{env['TEMPLATE_NAME']}.json")
        self.call = awscli.Aws(timeout=None).call

    def cfn(self, *args):
        return self.call("cloudformation", *args, region=self.region)

    def describe(self):
        """The stack, None when it doesn't exist; any other failure stops the deploy (cfn)."""
        try:
            return cfn.describe(self.call, self.region, self.stack)
        except cfn.Failed as e:
            raise Fail(str(e) + ("\nThe job's AWS credentials expired. If a stack update was under way, CloudFormation "
                                 "carries on regardless: re-run this job and it waits for the stack to settle, then deploys."
                                 if e.code == cfn.CREDS else ""))

    def status(self):
        s = self.describe()
        return s["StackStatus"] if s else ""

    def print_failures(self):
        err(f"Failed resources of {self.stack} (latest first):")
        for line in cfn.failed_events(self.call, self.region, self.stack, limit=10) or ["(none could be read)"]:
            err(f"  {line}")

    def settled(self):
        """Wait while the stack is busy (another run, or our own change set), until the job's deadline."""
        while True:
            st = self.status()
            if not cfn.busy(st):
                return st
            if time.time() >= self.deadline:
                raise Fail(f"Stack {self.stack} still {st} after waiting; giving up. Re-run this job: it waits for the stack "
                           "to settle, then deploys.")
            time.sleep(self.poll)

    def params_file(self):
        """Caller-supplied pairs first, then AssetsBucket* (package.py rewrote nested templates to
        require them). Real newlines from every caller, so a backslash in a value stays one."""
        params = []
        lines = (self.env.get("STACK_PARAMETERS") or "").split("\n") + [f"AssetsBucketName={self.bucket}",
                                                                          f"AssetsBucketPrefix={self.prefix}"]
        for line in lines:
            if not line.strip():
                continue
            if "=" not in line:
                raise Fail(f"Malformed STACK_PARAMETERS line (missing =): {line!r}")
            key, _, value = line.partition("=")
            params.append({"ParameterKey": key.strip(), "ParameterValue": value})
        path = os.path.join("dist", f"{self.stack}.params.json")
        os.makedirs("dist", exist_ok=True)
        with open(path, "w") as f:
            json.dump(params, f)
        return path

    def change_set(self, cs):
        """describe-change-set's record ({} when it can't be read)."""
        code, out, _ = self.cfn("describe-change-set", *cs)
        return json.loads(out or "{}") if code == 0 else {}

    def run(self):
        initial = self.status()
        # Still running from another run (a retried or timed-out job, a concurrent pipeline): a change
        # set can't be created until it settles, so wait for it, then deploy from where it ended.
        if cfn.busy(initial):
            say(f"Stack {self.stack} is {initial} (another deploy, or one that was interrupted); waiting for it to finish.")
            initial = self.settled()
            say(f"Stack {self.stack} is now {initial or '<gone>'}.")
        try:
            initial = cfn.clear_failed_create(self.call, self.region, self.stack, initial, say)
        except cfn.Failed as e:
            raise Fail(str(e))
        cs_type = "CREATE" if initial in ("", "REVIEW_IN_PROGRESS") else "UPDATE"
        name = f"ci-{int(time.time())}-{random.randint(0, 32767)}"
        params = self.params_file()
        say(f"Deploying {self.stack} to {self.region} ({cs_type})\n  template:   {self.url}\n  changeset:  {name}\n"
            f"  params:     {params}\n  initial:    {initial or '<stack does not exist>'}")

        try:
            code, out, msg = self.cfn("create-change-set", "--stack-name", self.stack, "--change-set-name", name,
                                      "--change-set-type", cs_type, "--template-url", self.url, "--parameters", f"file://{params}",
                                      "--capabilities", "CAPABILITY_IAM", "CAPABILITY_NAMED_IAM", "CAPABILITY_AUTO_EXPAND",
                                      *(["--role-arn", self.role_arn] if self.role_arn else []))
        finally:
            os.remove(params)   # it holds noEcho values: never left on disk after the call (review 10j D2)
        if code != 0:
            # CloudFormation's own refusal (a stack in UPDATE_ROLLBACK_FAILED or DELETE_FAILED, a role
            # it can't use, ...), with what failed last on an existing stack.
            err(f"create-change-set failed: {msg}")
            if "UPDATE_ROLLBACK_FAILED" in msg:
                err(f"Fix the resource named below, then: aws cloudformation continue-update-rollback --region {self.region} "
                    f"--stack-name {self.stack}   and re-run.")
            if initial:
                self.print_failures()
            raise Fail("")
        cs = ("--stack-name", self.stack, "--change-set-name", name)
        code, _, _ = self.cfn("wait", "change-set-create-complete", *cs)
        if code == 0:
            return self.outputs(self.execute(name, cs, initial))
        # The waiter fails on an empty change set (no differences): that one is done, not failed.
        d = self.change_set(cs)
        reason = d.get("StatusReason") or ""
        if not re.search(r"didn't contain changes|No updates", reason):
            raise Fail(f"Change-set creation failed: {d.get('Status') or '?'}: {reason or '(no reason given)'}")
        say("No changes to deploy — treating empty change-set as success.")
        self.cfn("delete-change-set", *cs)
        if cs_type == "UPDATE":
            return self.outputs(initial)
        # An empty CREATE leaves a REVIEW_IN_PROGRESS stack shell: removed (and waited for, or the next
        # run found the shell still there, review 10g D4) so the next run starts fresh.
        why = cfn.delete(self.call, self.region, self.stack)
        if why:
            raise Fail(f"Could not remove the empty {self.stack} shell: {why}")
        return self.outputs("")

    def execute(self, name, cs, initial):
        """Run the change set; the stack's final status (CREATE_COMPLETE or UPDATE_COMPLETE)."""
        say(f"Executing change-set {name}")
        code, _, msg = self.cfn("execute-change-set", *cs)
        if code != 0:
            raise Fail(f"execute-change-set failed: {msg}")
        # Poll until the stack actually leaves its prior status: a wait against a stack already in
        # CREATE_COMPLETE / UPDATE_COMPLETE can return before CloudFormation switched it to
        # _IN_PROGRESS. A small update can also go COMPLETE → IN_PROGRESS → COMPLETE between two
        # polls, so the change set's own ExecutionStatus reaching an end proves it ran too. The 600 s
        # limit turns any remaining hang into a clear failure.
        say(f"Waiting for stack to begin transitioning from {initial or '<none>'}")
        limit = time.time() + 600
        # A first create starts from the REVIEW_IN_PROGRESS shell create-change-set made, not from
        # nothing: seeing it right after execute-change-set is "not started yet" (review 10d D7).
        before = (initial, "REVIEW_IN_PROGRESS") if not initial else (initial,)
        while True:
            current = self.status()
            if current and current not in before:
                say(f"Stack transitioned to: {current}")
                break
            ex = self.change_set(cs).get("ExecutionStatus") or ""
            if ex in ("EXECUTE_COMPLETE", "EXECUTE_FAILED") and not (not initial and current == "REVIEW_IN_PROGRESS"):
                say(f"Change-set execution finished ({ex}) between polls; stack is {current or '<gone>'}")
                break
            if time.time() >= limit:
                raise Fail(f"Stack never left {initial or '<none>'} within 600s of executing {name} (change-set: {ex or '<unknown>'})")
            time.sleep(min(5, self.poll))
        # Our own bounded wait (the CLI waiters stop at 60 minutes, GitLab's default job timeout).
        try:
            final = self.settled()
        except Fail:
            self.print_failures()
            raise
        if final not in ("CREATE_COMPLETE", "UPDATE_COMPLETE"):
            err(f"Stack {self.stack} ended {final or '<gone>'}, not CREATE_COMPLETE / UPDATE_COMPLETE.")
            self.print_failures()
            raise Fail("")
        return final

    def outputs(self, final):
        """Write the outputs file of a stack whose deploy ended `final` ("" for an empty first create)."""
        out_file = self.env.get("OUTPUTS_FILE") or os.path.join("dist", f"{self.stack}.env")
        os.makedirs(os.path.dirname(out_file) or ".", exist_ok=True)
        if not final:
            say(f"Stack {self.stack} not present after deploy (empty CREATE); no outputs to capture.")
            # Still write the file: the stack job publishes it as its artifact for the jobs that need it.
            open(out_file, "w").close()
            return 0
        s = self.describe()
        if s is None:
            raise Fail(f"Stack {self.stack} is gone after its deploy: no outputs to read.")
        outputs = s.get("Outputs") or []
        wanted = self.env.get("OUTPUTS")
        if wanted is not None:
            keep = set(wanted.split())
            outputs = [o for o in outputs if o["OutputKey"] in keep]
        prefix = self.env.get("OUTPUTS_PREFIX", "")
        if self.env.get("GITLAB_CI"):
            # GitLab expands `$NAME` in a dotenv value when the next job uses it (an unknown name
            # becomes empty) and trims leading/trailing spaces, so the next stack would get another
            # value than locally or on GitHub (review 10c D3). Refused, naming the output.
            bad = [o["OutputKey"] for o in outputs if "$" in o["OutputValue"] or o["OutputValue"] != o["OutputValue"].strip()]
            if bad:
                raise Fail(f"Output(s) {', '.join(bad)} of {self.stack} contain a `$` or leading/trailing spaces, which GitLab "
                           "would change on the way to the next stack (it expands $NAME in job variables and trims spaces). Change "
                           "the output's value (e.g. encode it, or pass the parts separately).")
        # One line per output in the env file (a dotenv artifact, $GITHUB_ENV, the local deploy's
        # file): a newline in a value can't go through (review 10d D9). crelib.output_vars refuses it,
        # the same for the local deploy (review 10f D4).
        try:
            lines = crelib.output_vars(outputs, prefix, self.stack)
        except ValueError as e:
            raise Fail(str(e))
        with open(out_file, "w") as f:
            for key, value in lines:
                f.write(f"{key}={value}\n")
        say(f"Stack outputs written to {out_file}")
        return 0


def main():
    # Throttling: the CLI's own retry on every call (create-change-set and the polls included), not
    # a loop around one of them: aws.cli_env's, where a value the caller set wins.
    env = dict(os.environ)
    try:
        role_arn = preflight(env)
        return Deploy(env, role_arn).run()
    except Fail as e:
        if str(e):
            err(str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())
