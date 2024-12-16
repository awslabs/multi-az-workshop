# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
import boto3
import uuid
import random

fis = boto3.client("fis")

def handler(event, context):
  experiments = event['LatencyExperiments']
  index = random.randint(0, len(experiments) - 1)
  experiment = experiments[index]
  token = str(uuid.uuid4())
  fis.start_experiment(clientToken = token, experimentTemplateId = experiment)
  return "Increased latency: " + experiment