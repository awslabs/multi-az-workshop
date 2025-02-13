#!/bin/bash

rootDirectory="/opt/codedeploy-agent/deployment-root"
app="$rootDirectory/$DEPLOYMENT_GROUP_ID/$DEPLOYMENT_ID/deployment-archive/container.tar.gz"
cw="$rootDirectory/$DEPLOYMENT_GROUP_ID/$DEPLOYMENT_ID/deployment-archive/cloudwatch-agent.tar.gz"

/usr/bin/docker load < $app
/usr/bin/docker load < $cw