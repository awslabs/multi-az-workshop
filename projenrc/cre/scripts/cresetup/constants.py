"""The names and settings the Python scripts share, CI's and a laptop's: one copy (review 10i G1). crelib re-exports
them for the git, build, template and cfs scripts. The TypeScript side has its own copies, which
test/deploy-tasks.test.ts keeps equal: setup-cdk/lib/names.ts (role, stack and tag names),
deploy-tasks.ts DEFAULT_BINDLE_ID, gitlab-workflow.ts DEPLOY_ENVIRONMENT, stack-plan.ts's
control-plane tables.
"""
import os
import re

# What only a laptop needs (Midway, the GitLab host, the bindle) is local_constants.py: CI's scripts
# import this file, never that one.
DEPLOY_ENVIRONMENT = "AWS"   # the environment every deploy job declares on GitLab, and on a public GitHub repo
# The weekly upgrade's read-only role (versions:update). Its job runs in no environment, so the
# variable is the repo's / every scope's, never the deploy environment's.
VERSIONS_ROLE_VARIABLE = "VERSIONS_ROLE_ARN"

# Each partition's IAM and Route 53 control-plane regions: where setup's stacks, a CreIamStack and
# a CreDnsStack deploy, whatever the project's regions.
IAM_CONTROL_PLANE = {"aws": "us-east-1", "aws-us-gov": "us-gov-west-1", "aws-cn": "cn-north-1", "aws-eusc": "eusc-de-east-1"}
DNS_CONTROL_PLANE = {"aws": "us-east-1", "aws-us-gov": "us-gov-west-1", "aws-cn": "cn-northwest-1", "aws-eusc": "eusc-de-east-1"}

# setup-cdk/lib/names.ts
EXEC_ROLE = "CreCfnExecution"
GITHUB_OIDC_HOST = "token.actions.githubusercontent.com"
TAG_MANAGED, MANAGED_BY = "cre:managed-by", "cre-setup"


def runner_role(provider, project):
    return f"{'GitLabRunner' if provider == 'gitlab' else 'GitHubRunner'}-{project}"


def iam_stack(project):
    return f"CreSetup-{project}"


def dns_stack(project):
    return f"CreSetupDns-{project}"


def dns_deploy_role(project):
    return f"CreDnsDeploy-{project}"


def assets_stack(project):
    return f"CreAssets-{project}"


# How the AWS CLI says the credentials lapsed or are gone, by key, SSO or credential_process: the
# setup steps' 11 and the build scripts' credentials stop read the same list.
CREDENTIALS_LAPSED = re.compile(
    r"\((ExpiredToken|ExpiredTokenException|InvalidClientTokenId|InvalidAccessKeyId|SignatureDoesNotMatch"
    r"|UnrecognizedClientException|RequestExpired)\)|security token included in the request is expired"
    r"|Error when retrieving credentials|SSO session .*expired|Unable to locate credentials"
    r"|Token has expired and refresh failed|The config profile \(.*\) could not be found")
