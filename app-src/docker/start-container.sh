#!/bin/bash

rootDirectory="/opt/codedeploy-agent/deployment-root"
compose="$rootDirectory/$DEPLOYMENT_GROUP_ID/$DEPLOYMENT_ID/deployment-archive/docker/docker-compose.yml"
env="$rootDirectory/$DEPLOYMENT_GROUP_ID/$DEPLOYMENT_ID/deployment-archive/docker/.env"
DB_SECRET=$(cat /etc/secret)
echo "DB_SECRET=$DB_SECRET" >> $env
docker compose --file $compose --env-file $env up --detach