#!/bin/bash

rootDirectory="/opt/codedeploy-agent/deployment-root"
compose="$rootDirectory/$DEPLOYMENT_GROUP_ID/$DEPLOYMENT_ID/deployment-archive/docker/docker-compose.yml"
DB_SECRET=$(cat /etc/secret)
docker compose --file $compose up --detach --env DB_SECRET=$DB_SECRET