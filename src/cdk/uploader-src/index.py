# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
import boto3
import cfnresponse
import os
import base64
import subprocess
import sys
import traceback
import time
import json
from urllib.parse import urlparse

ecr_client = boto3.client("ecr")
s3_client = boto3.client("s3")
cb_client = boto3.client("codebuild")

os.environ['PATH'] = '/opt/helm:' + os.environ['PATH']

def handler(event, context):
    print(json.dumps(event, default = str))
    responseData = {}

    request_type = event["RequestType"]

    if request_type == "Create" or request_type == "Update":
    
        try:
            type = event["ResourceProperties"]["Type"]
            bucket = event["ResourceProperties"]["Bucket"]
            key = event["ResourceProperties"]["Key"]
            repo_name = event["ResourceProperties"]["Repository"]
            
            if type == "Helm":
                
                response = ecr_client.get_authorization_token(registryIds = [ os.environ.get("AWS_ACCOUNT_ID") ])
                username, password = base64.b64decode(response["authorizationData"][0]["authorizationToken"]).decode().split(":")
                endpoint = response["authorizationData"][0]["proxyEndpoint"]
                domain = urlparse(endpoint).netloc

                s3_client.download_file(bucket, key, "/tmp/" + key.split("/")[-1])

                output = subprocess.check_output(["helm", "registry", "login", "--username", username, "--password", password, domain], stderr=subprocess.STDOUT, cwd="/tmp")
                print(output)
                output = subprocess.check_output(["helm", "push", "/tmp/" + key.split("/")[-1], "oci://" + domain ], stderr=subprocess.STDOUT, cwd="/tmp")
                print(output)
                images = ecr_client.describe_images(repositoryName = repo_name)
                print(json.dumps(images, default = str))

                if "imageDetails" in images and len(images["imageDetails"]) > 0 and "imageTags" in images["imageDetails"][0]:
                    responseData["Tags"] = images["imageDetails"][0]["imageTags"]

                responseData["RepositoryName"] = repo_name

                cfnresponse.send(event, context, cfnresponse.SUCCESS, responseData)

            elif type == "Docker":

                project = event["ResourceProperties"]["ProjectName"]
                build = cb_client.start_build(projectName = project, environmentVariablesOverride = [
                    { "name": "BUCKET", "value": bucket, "type": "PLAINTEXT"},
                    { "name": "KEY", "value": key, "type": "PLAINTEXT"},
                    { "name": "REPO", "value": repo_name, "type": "PLAINTEXT"}
                ])
                build_id = build["build"]["id"]
                build_arn = build["build"]["arn"]
                build_number = build["build"]["buildNumber"]
                build_status = build["build"]["buildStatus"]

                while build_status == "IN_PROGRESS" and context.get_remaining_time_in_millis() > 6000:
                    time.sleep(5)
                    builds = cb_client.batch_get_builds(ids = [build_id])
                    
                    print(json.dumps(builds, default = str))

                    if len(builds["builds"]) > 0 and "buildStatus" in builds["builds"][0]:
                        build_status = builds["builds"][0]["buildStatus"]

                if build_status == "SUCCEEDED":
                    responseData["ProjectName"] = project
                    cfnresponse.send(event, context, cfnresponse.SUCCESS, responseData)
                else:
                    cfnresponse.send(event, context, cfnresponse.FAILED, responseData, reason = "CodeBuild project did not complete with status: " + build_status)

        except Exception as e:
            print(e)
            exc_info = sys.exc_info()
            details = "\n".join(traceback.format_exception(*exc_info))

            cfnresponse.send(event, context, cfnresponse.FAILED, responseData, reason = details)

    else:
        cfnresponse.send(event, context, cfnresponse.SUCCESS, responseData)