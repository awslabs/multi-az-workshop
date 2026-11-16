#!/usr/bin/env node

// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Runtime version loader for build tasks
 * Reads versions.json and outputs environment variable exports (each entry's version)
 */

const fs = require('fs');
const path = require('path');

const versionsPath = path.join(__dirname, 'versions.json');

try {
  const versions = JSON.parse(fs.readFileSync(versionsPath, 'utf-8'));
  
  // Output as environment variables for shell consumption: each entry's version, and a container
  // image's name without its tag as <KEY>_IMAGE (build/versions.py documents the entry kinds).
  Object.entries(versions).forEach(([key, entry]) => {
    console.log(`export ${key}="${entry.version}"`);
    if (entry.image) console.log(`export ${key}_IMAGE="${entry.image}"`);
  });
} catch (error) {
  console.error('Error loading versions.json:', error.message);
  process.exit(1);
}
