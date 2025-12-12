#!/bin/bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

counter=0
code=""

while [[ $code -ne 200 && $counter -lt 25 ]]
do
  code=$(curl -s -w "%{http_code}\n" http://localhost:5000/health -o /dev/null)
  echo $counter ":" $code
  counter=$[$counter + 1]
  sleep 2
done

if [ $code -eq 200 ]
then
    exit 0
else
    exit 1
fi