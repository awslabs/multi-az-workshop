/**
 * Jest globalSetup: gives the test run its own temp directory, removed by global-teardown.js.
 *
 * A CDK `new App()` without an `outdir` synthesizes into a fresh `cdk.out*` directory under the
 * OS temp directory and never removes it. A test run synthesizes hundreds of apps, so the temp
 * directory grew by gigabytes a day. Pointing TMPDIR at a per-run directory keeps every one of
 * them in a place the teardown deletes.
 *
 * This runs in Jest's parent process before the test workers start, so the workers inherit the
 * variable. Setting it in a test file's setup would not work: Jest gives each test file a copy of
 * process.env, and Node's os.tmpdir() (which CDK calls) reads the real one.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cre-jest-'));
  process.env.CRE_JEST_TMPDIR = dir;
  process.env.TMPDIR = dir;
};
