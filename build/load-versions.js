#!/usr/bin/env node

/**
 * Runtime version loader for build tasks
 * Reads versions.json and outputs environment variable exports
 */

const fs = require('fs');
const path = require('path');

const versionsPath = path.join(__dirname, 'versions.json');

try {
  const versions = JSON.parse(fs.readFileSync(versionsPath, 'utf-8'));
  
  // Output as environment variables for shell consumption
  Object.entries(versions).forEach(([key, value]) => {
    console.log(`export ${key}="${value}"`);
  });
} catch (error) {
  console.error('Error loading versions.json:', error.message);
  process.exit(1);
}
