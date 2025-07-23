#!/bin/bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

rm -rf docker/src
mkdir -p docker/src
#dotnet publish --configuration Release --runtime osx-x64 --output docker/src -p:PublishReadyToRun=true -p:PublishReadyToRunShowWarnings=true --self-contained
dotnet publish --configuration Release --runtime linux-musl-x64 --output docker/src -p:PublishReadyToRun=true -p:PublishReadyToRunShowWarnings=true --self-contained
#dotnet publish --configuration Release --runtime linux-x64 --output docker/src -p:PublishReadyToRun=true -p:PublishReadyToRunShowWarnings=true --self-contained
cd docker
docker build --tag multi-az-workshop/app:latest --platform linux/amd64 --build-arg SRC=src --build-arg PLATFORM=linux/amd64 . && docker-compose up --detach --wait