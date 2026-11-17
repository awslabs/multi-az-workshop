/**
 * Jest globalTeardown: removes the run's temp directory made by global-setup.js, with every
 * `cdk.out*` directory the test apps synthesized into it. Jest runs it after a failing run too.
 */
const fs = require('fs');

module.exports = () => {
  const dir = process.env.CRE_JEST_TMPDIR;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
};
