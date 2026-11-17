/**
 * The third-party GitHub Actions the CRE workflows use, pinned to commit SHAs (the tag each one
 * was, alongside). Several run in jobs that hold the deploy role's credentials or the App's key, and
 * a tag can be moved to other code (review 10b D12). projen's own workflows pin some actions by tag;
 * those are projen's choice (10b D12 kept them).
 * To update one: `gh api repos/<owner>/<repo>/git/ref/tags/<tag>` (dereference an annotated tag).
 */
export const ACTIONS = {
  checkout: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', // v7.0.1 (projen's own pin)
  setupNode: 'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', // v7.1.0
  configureAwsCredentials: 'aws-actions/configure-aws-credentials@e1253824e5c10ff9df46874f81ed3ec929e19cfd', // v6.3.0
  uploadArtifact: 'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9', // v7.0.2
  downloadArtifact: 'actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333', // v8.0.2
  createGithubAppToken: 'actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510', // v3.3.0
  setupQemu: 'docker/setup-qemu-action@99012661954931238ded8c8b007157a8430204e1', // v4.4.0 (v3 is a node20 action; runners dropped Node 20)
} as const;

/**
 * The Node.js major every CI job and the project run on (review 10c D9): GitLab's `node:<n>-alpine`
 * image, the deploy workflow's setup-node, projen's own workflows (`workflowNodeVersion`) and
 * package.json `engines` (`minNodeVersion`). Node 20 reached end of life in April 2026.
 */
export const NODE_MAJOR = '22';
