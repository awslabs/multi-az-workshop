#!/bin/bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# Define container names
CONTAINER1="multi-az-workshop-application"
CONTAINER2="cwagent"

# Function to stop a container if it exists
stop_container() {
    local container_name=$1
    if /usr/bin/docker ps -q -f name="^${container_name}$" | grep -q .; then
        echo "Stopping container: $container_name"
        /usr/bin/docker stop "$container_name"
    else
        echo "Container $container_name is not running or does not exist."
    fi
}

# Stop the containers
stop_container "$CONTAINER1"
stop_container "$CONTAINER2"