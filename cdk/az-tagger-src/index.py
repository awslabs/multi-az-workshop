# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
import os
import boto3
import json
import sys
import traceback

ec2_client = boto3.client("ec2", os.environ.get("AWS_REGION", "us-east-1"))
zones = ec2_client.describe_availability_zones(AllAvailabilityZones=True)
zone_map = {}

for zone in zones["AvailabilityZones"]:
    zone_map[zone["ZoneName"]] = zone["ZoneId"]

def handler(event, context):
    details = {}
    details["Event"] = json.loads(json.dumps(event, default = str))

    try:
        instance_id = ""
        az_name = ""

        details["Source"] = event["source"]
        
        if event["source"] == "aws.autoscaling":  
          instance_id = event["detail"]["EC2InstanceId"]
          az_name = event ["detail"]["Details"]["Availability Zone"]
        elif event["source"] == "aws.ec2":
          instance_id = event["detail"]["instance-id"]
          instance = ec2_client.describe_instances(InstanceIds = [instance_id])
          az_name = instance['Reservations'][0]["Instances"][0]["Placement"]["AvailabilityZone"]
        else:
          az_name = ""
        
        details["AZName"] = az_name
        az_id = zone_map[az_name]
        details["AZ-ID"] = az_id

        ec2_client.create_tags(Resources = [instance_id], Tags = [ { "Key": "az-id", "Value": az_id }, { "Key": "az-name", "Value": az_name } ])
    except Exception as e:
        exc_info = sys.exc_info()
        error = traceback.format_exception(*exc_info)
        details["Error"] = error

    print(json.dumps(details))
    return None
    