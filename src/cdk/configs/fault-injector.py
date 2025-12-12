# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
import boto3
import uuid
import random

fis = boto3.client("fis")
codedeploy = boto3.client("codedeploy")

def handler(event, context):
  rand = random.randint(0, 2)
  if rand == 0:
    experiments = event['LatencyExperiments']
    index = random.randint(0, len(experiments) - 1)
    experiment = experiments[index]
    token = str(uuid.uuid4())
    fis.start_experiment(clientToken = token, experimentTemplateId = experiment)
    return "Increased latency: " + experiment
  elif rand == 1:
    experiments = event['PacketLossExperiments']
    index = random.randint(0, len(experiments) - 1)
    experiment = experiments[index]
    token = str(uuid.uuid4())
    fis.start_experiment(clientToken = token, experimentTemplateId = experiment)
    return "Elevated packet loss: " + experiment
  else:
    app = event['Deployment']
    deployment = codedeploy.create_deployment(
        applicationName = app['ApplicationName'],
        deploymentGroupName = app['DeploymentGroupName'],
        revision = {
            "revisionType": "S3",
            "s3Location": {
                "bucket": app["Bucket"],
                "key": app["ApplicationKey"],
                "bundleType": "zip"
            }
        },
        fileExistsBehavior = "OVERWRITE",
        autoRollbackConfiguration = {
          "enabled": False
        }
    )

    return "Failed deployment: " + deployment["deploymentId"]
  