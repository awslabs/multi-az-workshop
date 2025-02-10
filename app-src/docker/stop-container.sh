#!/bin/bash
set -e

docker compose down --file docker/docker-compose.yml || true