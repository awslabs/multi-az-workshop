# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
import os
import boto3
import json
import sys
import traceback
import time

ec2_client = boto3.client("ec2", os.environ.get("AWS_REGION", "us-east-1"))

def handler(event, context):
    details = {}
    details["Event"] = json.loads(json.dumps(event, default = str))

    try:
        instance_id = ""

        details["Source"] = event["source"]
        
        if event["source"] == "aws.autoscaling":  
          instance_id = event["detail"]["EC2InstanceId"]
        elif event["source"] == "aws.ec2":
          instance_id = event["detail"]["instance-id"]

        args = {"InstanceId": instance_id }
        
        instance = ec2_client.describe_instances(InstanceIds = [instance_id])["Reservations"][0]["Instances"][0]
        print(json.dumps(instance, default = str))

        tags = instance["Tags"]

        for tag in tags:
           if tag["Key"] == "eks:cluster-name":
              args["HttpPutResponseHopLimit"] = 3
              break
           
        response = ec2_client.modify_instance_metadata_options(**args)
        print(json.dumps(response, default = str))

    except Exception as e:
        exc_info = sys.exc_info()
        error = traceback.format_exception(*exc_info)
        details["Error"] = error

    print(json.dumps(details))
    return None
    