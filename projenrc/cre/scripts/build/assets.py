#!/usr/bin/env python3
"""The project's assets buckets: named from the project, the account and the region, and made by the
deploy itself the first time a region is used.

  assets.py upload --regions "<r1> <r2>"     every region's bucket made if missing, then
                                             dist/content synced to s3://<bucket>/$ASSETS_PREFIX
  assets.py bucket --region <r>              print the region's bucket name (this account's)

A region's bucket is `<B>-<account>-<region>-an`, in the S3 account regional namespace (only this
account can own the name), B the project name, or for a long one its first 23 characters and 8 of
its SHA-256 (setup-cdk/lib/names.ts, the same rule; a test keeps them equal). The account is the
one the credentials are for, so nothing about it is stored anywhere.

Each bucket is a CloudFormation stack, `CreAssets-<project>` in its region (capitalised, so neither
a stack of the project's own nor another project's `<name>-*` can take the name), deployed as
CFN_EXECUTION_ROLE_ARN. Its template is small and passed inline: no bucket is needed to make one.
`npx projen teardown` leaves it (the buckets hold the deploys' templates); `npx projen unbootstrap`
empties and deletes it. A stack that is there with this template and these
parameters is left alone (one DescribeStacks per region); otherwise it is deployed. With
DNS_ROLE_ARN set, the DNS account's deploy role may read the templates (the project's `-dns` stack
deploys there from them); with it unset the stack keeps the role it has.

Environment: PROJECT_NAME, ASSETS_PREFIX (upload), CFN_EXECUTION_ROLE_ARN and DNS_ROLE_ARN (optional).
Exit: 0 done; 1 a step failed (its message says which).
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import crelib  # noqa: E402,F401  (puts cresetup/ on the path: the aws CLI runner and the stack state)
import aws as awscli  # noqa: E402
import cfn  # noqa: E402
from constants import assets_stack as stack_name  # noqa: E402,F401  (CreAssets-<project>: one copy)

PROJECT = re.compile(r"^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]$")
S3_RESERVED_PREFIXES = ("xn--", "sthree-", "amzn-s3-demo-")   # cresetup/project_name.py, names.ts (a test keeps them equal)
BUCKET_PREFIX_MAX = 63 - (1 + 12 + 1 + 14 + 3)   # S3's 63 minus `-<account>-<longest region>-an`
OK_STATES = ("CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE")


class Fail(Exception):
    pass


def bucket_prefix(project):
    if not PROJECT.match(project):
        raise Fail(f"project name {project!r}: 3-42 lowercase letters, digits and hyphens")
    reserved = next((p for p in S3_RESERVED_PREFIXES if project.startswith(p)), None)
    if reserved:
        raise Fail(f"project name {project!r}: S3 refuses bucket names starting with {reserved!r}")
    if len(project) <= BUCKET_PREFIX_MAX:
        return project
    return f"{project[:23].rstrip('-')}-{hashlib.sha256(project.encode()).hexdigest()[:8]}"


def bucket_name(project, account, region):
    return f"{bucket_prefix(project)}-{account}-{region}-an"


def template(project):
    """The bucket stack: S3's own defaults stated (no public access, owner-enforced, SSE-S3)."""
    return {
        "AWSTemplateFormatVersion": "2010-09-09",
        "Description": f"Assets bucket of CRE project {project} (made by its deploy)",
        "Parameters": {"DnsRoleArn": {"Type": "String", "Default": ""}},
        "Conditions": {"DnsReads": {"Fn::Not": [{"Fn::Equals": [{"Ref": "DnsRoleArn"}, ""]}]}},
        "Resources": {
            "Bucket": {"Type": "AWS::S3::Bucket", "Properties": {
                "BucketNamePrefix": bucket_prefix(project), "BucketNamespace": "account-regional",
                "PublicAccessBlockConfiguration": {"BlockPublicAcls": True, "BlockPublicPolicy": True, "IgnorePublicAcls": True,
                                                   "RestrictPublicBuckets": True},
                "OwnershipControls": {"Rules": [{"ObjectOwnership": "BucketOwnerEnforced"}]},
                "BucketEncryption": {"ServerSideEncryptionConfiguration": [{"ServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]},
                "Tags": [{"Key": "cre:project", "Value": project}, {"Key": "cre:managed-by", "Value": "cre-deploy"}]}},
            "DnsReadsTemplates": {"Type": "AWS::S3::BucketPolicy", "Condition": "DnsReads", "Properties": {
                "Bucket": {"Ref": "Bucket"},
                "PolicyDocument": {"Version": "2012-10-17", "Statement": [{
                    # The account as principal, the role in a condition: a policy naming a role that is
                    # later re-created would otherwise stop matching it.
                    "Sid": "DnsAccountReadsTemplates", "Effect": "Allow", "Action": "s3:GetObject",
                    "Principal": {"AWS": {"Fn::Sub": ["arn:${AWS::Partition}:iam::${Account}:root",
                                                      {"Account": {"Fn::Select": [4, {"Fn::Split": [":", {"Ref": "DnsRoleArn"}]}]}}]}},
                    "Resource": {"Fn::Sub": "${Bucket.Arn}/*"},
                    "Condition": {"ArnEquals": {"aws:PrincipalArn": {"Ref": "DnsRoleArn"}}}}]}}},
        },
        "Outputs": {"BucketName": {"Value": {"Ref": "Bucket"}}},
    }


aws = awscli.Aws(timeout=None).call   # this process's credentials (a test replaces it)


def account():
    try:
        return awscli.identity(aws)[0]
    except cfn.Failed as e:
        raise Fail(f"Reading the AWS account: {e}")


def template_hash(body):
    return hashlib.sha256(body.encode()).hexdigest()[:16]


def ensure_bucket(project, region, dns_role, role_arn, say):
    """The region's bucket stack, deployed only when missing or not this template and parameters.
    dns_role None (DNS_ROLE_ARN unset, a local run without --dns-profile): the stack keeps the one it
    has, so a deploy that doesn't name it never takes the DNS account's template access away (10i D1).
    Another deploy of it running is no case here: both pipelines run their upload one at a time
    (GitLab's resource_group, GitHub's concurrency group), and CloudFormation would refuse it anyway."""
    name = stack_name(project)
    body = json.dumps(template(project), sort_keys=True)
    try:
        s = cfn.describe(aws, region, name)
    except cfn.Failed as e:
        if re.search(r"InvalidClientTokenId|UnrecognizedClientException", str(e)):
            # What STS answers in an opt-in region the account hasn't enabled: the region, not the
            # credentials (the same credentials just worked elsewhere) (review 10i A1).
            raise Fail(f"Region {region} answered as if the credentials were invalid: it is most likely an opt-in region this "
                       f"account hasn't enabled. Enable it (aws account enable-region --region-name {region}), or deploy the "
                       "stack in another region.")
        raise Fail(f"Reading the assets bucket stack: {e}")
    have = {p["ParameterKey"]: p.get("ParameterValue", "") for p in (s or {}).get("Parameters", [])}
    dns_role = have.get("DnsRoleArn", "") if dns_role is None else dns_role
    wanted = {"DnsRoleArn": dns_role, "TemplateHash": template_hash(body)}
    if s:
        tags = {t["Key"]: t["Value"] for t in s.get("Tags", [])}
        if s["StackStatus"] in OK_STATES and have.get("DnsRoleArn", "") == dns_role and tags.get("cre:template") == wanted["TemplateHash"]:
            return
        try:
            cfn.clear_failed_create(aws, region, name, s["StackStatus"], say)
        except cfn.Failed as e:
            raise Fail(str(e))
    say(f"→  deploy the assets bucket stack {name} in {region}")
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        f.write(body)
    try:
        args = ["cloudformation", "deploy", "--stack-name", name, "--template-file", f.name, "--no-fail-on-empty-changeset",
                "--parameter-overrides", f"DnsRoleArn={dns_role}", "--tags", f"cre:project={project}",
                f"cre:template={wanted['TemplateHash']}"]
        if role_arn:
            args += ["--role-arn", role_arn]
        c, _, e = aws(*args, region=region)
        if c:
            why = "; ".join(cfn.failed_events(aws, region, name))
            raise Fail(f"Deploying the assets bucket stack {name} in {region}: {why or e[-1500:]}")
    finally:
        os.unlink(f.name)


def upload(a, say):
    project, prefix = os.environ.get("PROJECT_NAME", ""), os.environ.get("ASSETS_PREFIX", "")
    if not project or not prefix:
        raise Fail("PROJECT_NAME and ASSETS_PREFIX must be set")
    regions = a.regions.split()
    acct = account()
    for r in regions:
        ensure_bucket(project, r, os.environ.get("DNS_ROLE_ARN"), os.environ.get("CFN_EXECUTION_ROLE_ARN", ""), say)
    for r in regions:
        b = bucket_name(project, acct, r)
        say(f"Syncing dist/content/ → s3://{b}/{prefix}")
        # --region explicit: no auto-discovery HEAD call, which a scoped policy needn't allow.
        cmd = ["aws", "s3", "sync", "--no-progress", "--region", r, "--exclude", "containers/*", "dist/content", f"s3://{b}/{prefix}"]
        p = subprocess.run(cmd, stdin=subprocess.DEVNULL, env=awscli.cli_env())
        if p.returncode < 0:
            # The CLI itself killed by a signal (Alpine's aws-cli 2.34.63 segfaulted once mid-sync,
            # request-router-metadata-app, Nov 2026), not an answer from S3. A sync is idempotent:
            # once more, said out loud. Any failure S3 or the CLI reports fails at once.
            say(f"⚠  aws s3 sync was killed by signal {-p.returncode} (the CLI crashed, not S3): syncing once more")
            p = subprocess.run(cmd, stdin=subprocess.DEVNULL, env=awscli.cli_env())
        if p.returncode:
            raise Fail(f"Syncing to s3://{b}/{prefix} failed (exit {p.returncode})")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="assets.py")
    sub = ap.add_subparsers(dest="mode", required=True)
    u = sub.add_parser("upload", help="make every region's bucket if missing, then sync dist/content to it")
    u.add_argument("--regions", required=True, help="space-separated")
    b = sub.add_parser("bucket", help="print a region's bucket name, for this account")
    b.add_argument("--region", required=True)
    a = ap.parse_args(argv)

    def say(msg):
        print(msg, file=sys.stderr, flush=True)
    try:
        if a.mode == "upload":
            t0 = time.time()
            upload(a, say)
            say(f"Uploaded to {len(a.regions.split())} region(s) in {time.time() - t0:.1f}s")
        else:
            print(bucket_name(os.environ.get("PROJECT_NAME", ""), account(), a.region))
    except Fail as e:
        print(f"❌ {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
