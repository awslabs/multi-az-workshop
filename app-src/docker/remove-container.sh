#!/bin/bash

rootDirectory="/opt/codedeploy-agent/deployment-root"
compose="$rootDirectory/$DEPLOYMENT_GROUP_ID/$DEPLOYMENT_ID/deployment-archive/docker/docker-compose.yml"

docker compose rm -f $compose --force --stop --volumes