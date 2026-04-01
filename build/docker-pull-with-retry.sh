#!/usr/bin/env bash
# Pulls a docker image with exponential backoff and jitter on rate limit errors.
# Usage: docker-pull-with-retry.sh <image> [max_retries]

set -euo pipefail

IMAGE="$1"
MAX_RETRIES="${2:-3}"

for attempt in $(seq 1 "$MAX_RETRIES"); do
  if docker pull "$IMAGE"; then
    exit 0
  fi

  if [ "$attempt" -eq "$MAX_RETRIES" ]; then
    echo "Failed to pull $IMAGE after $MAX_RETRIES attempts"
    exit 1
  fi

  # Exponential backoff: 2^attempt * (10-30s jitter)
  BASE_DELAY=$(( 2 ** attempt * 10 ))
  JITTER=$(( RANDOM % (BASE_DELAY / 2 + 1) ))
  DELAY=$(( BASE_DELAY + JITTER ))
  echo "Rate limited pulling $IMAGE. Retrying in ${DELAY}s (attempt $attempt/$MAX_RETRIES)..."
  sleep "$DELAY"
done
