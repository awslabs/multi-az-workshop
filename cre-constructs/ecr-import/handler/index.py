"""CreEcrImport's custom resource: start one build for the artifacts not yet in ECR, then wait for it.

on_event: Create/Update start the build (CodeBuild project PROJECT) for the artifacts whose tag
isn't in their repository yet; none missing (a redeploy, a rollback): no build. Delete: nothing
(the repositories go with the stack, images and all). is_complete: done when the build succeeded.
"""
import json
import os

import boto3
from botocore.config import Config

CONFIG = Config(connect_timeout=5, read_timeout=20, retries={"max_attempts": 3, "mode": "standard"})
codebuild = boto3.client("codebuild", config=CONFIG)
ecr = boto3.client("ecr", config=CONFIG)


def present(a):
    try:
        ecr.describe_images(repositoryName=a["repository"], imageIds=[{"imageTag": a["tag"]}])
        return True
    except ecr.exceptions.ImageNotFoundException:
        return False


def on_event(event, _context):
    if event["RequestType"] == "Delete":
        return {"PhysicalResourceId": event["PhysicalResourceId"], "Data": {"BuildId": ""}}
    p = event["ResourceProperties"]
    missing = [a for a in json.loads(p["Artifacts"]) if not present(a)]
    build_id = ""
    if missing:
        build_id = codebuild.start_build(projectName=os.environ["PROJECT"], environmentVariablesOverride=[
            {"name": "ARTIFACTS", "value": json.dumps(missing), "type": "PLAINTEXT"},
            {"name": "REGISTRY", "value": p["Registry"], "type": "PLAINTEXT"},
        ])["build"]["id"]
    return {"PhysicalResourceId": event.get("PhysicalResourceId") or os.environ["PROJECT"], "Data": {"BuildId": build_id}}


def is_complete(event, _context):
    build_id = event.get("Data", {}).get("BuildId", "")
    if event["RequestType"] == "Delete" or not build_id:
        return {"IsComplete": True}
    b = codebuild.batch_get_builds(ids=[build_id])["builds"][0]
    if b["buildStatus"] == "IN_PROGRESS":
        return {"IsComplete": False}
    if b["buildStatus"] != "SUCCEEDED":
        raise RuntimeError(f"The ECR import build ended {b['buildStatus']}: {b.get('logs', {}).get('deepLink', build_id)}")
    return {"IsComplete": True}
