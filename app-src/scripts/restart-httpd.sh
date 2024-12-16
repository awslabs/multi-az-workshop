#!/bin/bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

systemctl restart httpd
systemctl enable httpd
systemctl status httpd