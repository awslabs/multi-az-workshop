# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
import boto3

codedeploy = boto3.client("codedeploy")

def handler(event, context):
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
  