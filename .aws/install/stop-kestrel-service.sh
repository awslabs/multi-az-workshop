#!/bin/bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

ACTIVE=$(systemctl is-active kestrel >/dev/null 2>&1 && echo true || echo false)

if [ $ACTIVE == true ]; then
    systemctl stop kestrel.service
fi