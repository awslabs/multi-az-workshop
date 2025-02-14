#!/bin/bash

ROOT_DIR="/opt/codedeploy-agent/deployment-root"
APP="$ROOT_DIR/$DEPLOYMENT_GROUP_ID/$DEPLOYMENT_ID/deployment-archive/container.tar.gz"
CW="$ROOT_DIR/$DEPLOYMENT_GROUP_ID/$DEPLOYMENT_ID/deployment-archive/cloudwatch-agent.tar.gz"

/usr/bin/docker load < $APP
/usr/bin/docker load < $CW