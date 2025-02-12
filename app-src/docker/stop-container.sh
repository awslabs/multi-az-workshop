#!/bin/bash
# Define container names
CONTAINER1="multi-az-workshop-application"
CONTAINER2="cwagent"

# Function to stop a container if it exists
stop_container() {
    local container_name=$1
    if docker ps -q -f name="^${container_name}$" | grep -q .; then
        echo "Stopping container: $container_name"
        docker stop "$container_name"
    else
        echo "Container $container_name is not running or does not exist."
    fi
}

# Stop the containers
stop_container "$CONTAINER1"
stop_container "$CONTAINER2"