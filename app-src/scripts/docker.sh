#!/bin/bash

aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin ${ACCOUNTID}.dkr.ecr.${AWS_REGION}.amazonaws.com
docker pull ${ACCOUNTID}.dkr.ecr${AWS_REGION}.amazonaws.com/multi-az-workshop:latest
docker pull ${ACCOUNTID}.dkr.ecr${AWS_REGION}.amazonaws.com/multi-az-workshop-fault:latest
docker compose up