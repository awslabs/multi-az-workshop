#!/bin/bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

rootDirectory="/opt/codedeploy-agent/deployment-root"
compose="$rootDirectory/$DEPLOYMENT_GROUP_ID/$DEPLOYMENT_ID/deployment-archive/docker/docker-compose.yml"
/usr/bin/docker compose --file $compose rm --force --stop --volumes