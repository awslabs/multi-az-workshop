#!/bin/bash

ROOT_DIR="/opt/codedeploy-agent/deployment-root"
COMPOSE_FILE="$ROOT_DIR/$DEPLOYMENT_GROUP_ID/$DEPLOYMENT_ID/deployment-archive/docker/docker-compose.yml"
ENV_FILE="$ROOT_DIR/$DEPLOYMENT_GROUP_ID/$DEPLOYMENT_ID/deployment-archive/docker/.env"
TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
INSTANCE_ID=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" -s http://169.254.169.254/latest/meta-data/instance-id)
DB_SECRET=$(cat /etc/secret)
echo "DB_SECRET=$DB_SECRET" >> $ENV_FILE
echo "AWS_EMF_LOG_STREAM_NAME=$INSTANCE_ID" >> $ENV_FILE
/usr/bin/docker compose --file $COMPOSE_FILE --env-file $ENV_FILE up --detach