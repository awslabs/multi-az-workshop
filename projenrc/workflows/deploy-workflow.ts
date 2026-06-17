// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Deploy workflow configuration
 *
 * Triggered by:
 *  - workflow_run on `auto-approve` (success): this is the primary pre-merge
 *    path for trusted authors. `auto-approve` only succeeds after the build
 *    passes, all required checks pass, and it submits an approval review. By
 *    construction, when it completes successfully every deploy prerequisite
 *    is satisfied — no approval race, no manual polling.
 *  - pull_request_review (approved): for human-submitted approvals on PRs
 *    that did not go through auto-approve. Verifies the build succeeded for
 *    the approved head SHA before deploying.
 *  - workflow_dispatch: manual deploys from main.
 *
 * Security model:
 *   Deploy holds AWS credentials. We never check out PR source in this
 *   privileged context. `dist/content.zip` is produced by the unprivileged
 *   `build` workflow and downloaded here as passive data for deployment.
 *   The PR's code never executes in this workflow. Manual dispatches check
 *   out main (trusted) and rebuild.
 *
 *   Additional hardening:
 *   - Artifact is only accepted from builds where head_repository matches
 *     github.repository and the event is 'push' or 'pull_request' from the
 *     same repo (not a fork).
 *   - Reviewer approval requires author_association of OWNER, MEMBER, or
 *     COLLABORATOR (write/admin access).
 *   - Deploy is restricted to artifacts built from the default branch (main).
 *   - All action references pinned to immutable commit SHAs.
 */

import { GithubWorkflow } from 'projen/lib/github';
import type { GitHub } from 'projen/lib/github';
import { JobPermission } from 'projen/lib/github/workflows-model';

// Pinned action SHAs
const ACTIONS = {
  checkout: 'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5', // v4
  setupNode: 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020', // v4
  setupDotnet: 'actions/setup-dotnet@67a3573c9a986a3f9c594539f4ab511d57bb3ce9', // v4
  uploadArtifact: 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a', // v7
  downloadArtifact: 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c', // v8
  configureAwsCreds: 'aws-actions/configure-aws-credentials@00943011d9042930efac3dcd3a170e4273319bc8', // v5.1.0
};

const TRUSTED_AUTHORS = ['hakenmt', 'github-actions[bot]', 'dependabot[bot]'];

export function createDeployWorkflow(github: GitHub): void {
  const workflow = new GithubWorkflow(github, 'deploy');

  workflow.on({
    workflowDispatch: {},
    workflowRun: { workflows: ['auto-approve'], types: ['completed'] },
    pullRequestReview: { types: ['submitted'] },
  });

  workflow.file?.addOverride('concurrency', {
    'group': 'deploy-${{ github.event.workflow_run.head_sha || github.event.pull_request.head.sha || github.sha }}',
    'cancel-in-progress': true,
  });

  const runActor = 'github.event.workflow_run.actor.login';
  const runTriggerer = 'github.event.workflow_run.triggering_actor.login';
  const prAuthor = 'github.event.pull_request.user.login';

  const authorAllowlist = TRUSTED_AUTHORS
    .map((u) => `${runActor} == '${u}' || ${runTriggerer} == '${u}' || ${prAuthor} == '${u}'`)
    .join(' || ');

  const gate = [
    "github.event_name == 'workflow_dispatch'",
    `(github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success' && (${authorAllowlist}))`,
    `(github.event_name == 'pull_request_review' && github.event.review.state == 'approved' && (${authorAllowlist}))`,
  ].join(' || ');

  addResolveJob(workflow, gate);
  addCreateDeploymentJob(workflow);
  addBuildFromMainJob(workflow);
  addDeployJob(workflow);
  addReportDeploymentJob(workflow);
}


function addResolveJob(workflow: GithubWorkflow, gate: string): void {
  workflow.addJob('resolve', {
    runsOn: ['ubuntu-latest'],
    if: gate,
    permissions: {
      actions: JobPermission.READ,
      contents: JobPermission.READ,
      pullRequests: JobPermission.READ,
      checks: JobPermission.READ,
    },
    outputs: {
      ref: { stepId: 'info', outputName: 'ref' },
      run_id: { stepId: 'build_check', outputName: 'run_id' },
      is_approved: { stepId: 'approval', outputName: 'is_approved' },
      build_ok: { stepId: 'build_check', outputName: 'build_ok' },
    },
    env: { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' },
    steps: [
      {
        name: 'Determine ref',
        id: 'info',
        run: [
          'set -eu',
          'if [ "${{ github.event_name }}" == "workflow_dispatch" ]; then',
          '  echo "Manual trigger - deploying from main"',
          '  echo "ref=main" >> "$GITHUB_OUTPUT"',
          'elif [ "${{ github.event_name }}" == "workflow_run" ]; then',
          '  echo "Triggered by auto-approve run ${{ github.event.workflow_run.id }}"',
          '  echo "ref=${{ github.event.workflow_run.head_sha }}" >> "$GITHUB_OUTPUT"',
          'else',
          '  echo "Triggered by PR review on #${{ github.event.pull_request.number }}"',
          '  echo "ref=${{ github.event.pull_request.head.sha }}" >> "$GITHUB_OUTPUT"',
          'fi',
        ].join('\n'),
      },
      {
        // Locates the successful `build` run for the head SHA. Requires the
        // build to have run from the same repository (not a fork) and from
        // the default branch (main) to prevent poisoned fork artifacts from
        // being deployed.
        name: 'Locate build run',
        id: 'build_check',
        run: [
          'set -eu',
          'if [ "${{ github.event_name }}" == "workflow_dispatch" ]; then',
          '  echo "build_ok=true" >> "$GITHUB_OUTPUT"',
          '  echo "run_id=" >> "$GITHUB_OUTPUT"',
          '  exit 0',
          'fi',
          'if [ "${{ github.event_name }}" == "workflow_run" ]; then',
          '  SHA="${{ github.event.workflow_run.head_sha }}"',
          'else',
          '  SHA="${{ github.event.pull_request.head.sha }}"',
          'fi',
          'REPO="${{ github.repository }}"',
          'echo "Looking for successful build run for SHA $SHA"',
          'BUILD_RUN=$(gh api "repos/$REPO/actions/workflows/build.yml/runs?head_sha=$SHA" --jq \'[.workflow_runs[] | select(.head_repository.full_name == "\'$REPO\'" and .event != "pull_request_target")] | sort_by(.run_number) | reverse | first\')',
          'if [ -z "$BUILD_RUN" ] || [ "$BUILD_RUN" = "null" ]; then',
          '  echo "No build run found for $SHA from trusted repository - skipping deploy"',
          '  echo "build_ok=false" >> "$GITHUB_OUTPUT"',
          '  echo "run_id=" >> "$GITHUB_OUTPUT"',
          '  exit 0',
          'fi',
          'CONCLUSION=$(echo "$BUILD_RUN" | jq -r .conclusion)',
          'RUN_ID=$(echo "$BUILD_RUN" | jq -r .id)',
          'HEAD_BRANCH=$(echo "$BUILD_RUN" | jq -r .head_branch)',
          'echo "Build run $RUN_ID conclusion: $CONCLUSION, branch: $HEAD_BRANCH"',
          'if [ "$CONCLUSION" != "success" ]; then',
          '  echo "Build did not succeed for $SHA - skipping deploy"',
          '  echo "build_ok=false" >> "$GITHUB_OUTPUT"',
          '  echo "run_id=" >> "$GITHUB_OUTPUT"',
          '  exit 0',
          'fi',
          '# Restrict deploy to artifacts built from main branch',
          'if [ "$HEAD_BRANCH" != "main" ]; then',
          '  echo "Build was not from main branch ($HEAD_BRANCH) - skipping deploy"',
          '  echo "build_ok=false" >> "$GITHUB_OUTPUT"',
          '  echo "run_id=" >> "$GITHUB_OUTPUT"',
          '  exit 0',
          'fi',
          'echo "build_ok=true" >> "$GITHUB_OUTPUT"',
          'echo "run_id=$RUN_ID" >> "$GITHUB_OUTPUT"',
        ].join('\n'),
      },
      {
        // Verifies an APPROVED review exists for the head SHA from a reviewer
        // with write/admin access (OWNER, MEMBER, or COLLABORATOR).
        name: 'Check PR approval status',
        id: 'approval',
        run: [
          'set -eu',
          'if [ "${{ github.event_name }}" == "workflow_dispatch" ]; then',
          '  echo "Manual dispatch - approval not required"',
          '  echo "is_approved=true" >> "$GITHUB_OUTPUT"',
          '  exit 0',
          'fi',
          'if [ "${{ github.event_name }}" == "workflow_run" ]; then',
          '  SHA="${{ github.event.workflow_run.head_sha }}"',
          'else',
          '  SHA="${{ github.event.pull_request.head.sha }}"',
          'fi',
          'REPO="${{ github.repository }}"',
          'PR_NUMBER=$(gh api "repos/$REPO/commits/$SHA/pulls" --jq \'[.[]] | first | .number // empty\')',
          'if [ -z "$PR_NUMBER" ]; then',
          '  echo "No PR found for SHA $SHA - skipping deploy"',
          '  echo "is_approved=false" >> "$GITHUB_OUTPUT"',
          '  exit 0',
          'fi',
          'echo "Found PR #$PR_NUMBER"',
          '# Require reviewer to have write/admin access (OWNER, MEMBER, or COLLABORATOR)',
          'APPROVED=$(gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" --paginate --jq \'[.[] | select(.commit_id == "\'\"$SHA\"\'") | select(.author_association == "OWNER" or .author_association == "MEMBER" or .author_association == "COLLABORATOR")] | group_by(.user.login) | map(sort_by(.submitted_at) | last) | [.[] | select(.state == "APPROVED")] | length\')',
          'echo "Approved reviews from authorized reviewers for this head SHA: $APPROVED"',
          'if [ "$APPROVED" -ge 1 ]; then',
          '  echo "PR #$PR_NUMBER is approved for SHA $SHA by authorized reviewer"',
          '  echo "is_approved=true" >> "$GITHUB_OUTPUT"',
          'else',
          '  echo "PR #$PR_NUMBER has no approved review from authorized reviewer for SHA $SHA - skipping deploy"',
          '  echo "is_approved=false" >> "$GITHUB_OUTPUT"',
          'fi',
        ].join('\n'),
      },
    ],
  });
}

function addCreateDeploymentJob(workflow: GithubWorkflow): void {
  workflow.addJob('create-deployment', {
    needs: ['resolve'],
    if: "needs.resolve.outputs.is_approved == 'true' && needs.resolve.outputs.build_ok == 'true'",
    runsOn: ['ubuntu-latest'],
    permissions: {
      contents: JobPermission.READ,
      deployments: JobPermission.WRITE,
    },
    outputs: {
      deployment_id: { stepId: 'create', outputName: 'deployment_id' },
    },
    env: {
      GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
      REF: '${{ needs.resolve.outputs.ref }}',
      REPO: '${{ github.repository }}',
    },
    steps: [
      {
        name: 'Create deployment',
        id: 'create',
        run: [
          'set -eu',
          'jq -nc --arg ref "$REF" \'{ref: $ref, environment: "AWS", auto_merge: false, required_contexts: [], auto_inactive: false}\' > /tmp/deployment.json',
          'echo "Payload:"; cat /tmp/deployment.json',
          'DEPLOYMENT_ID=$(gh api "repos/$REPO/deployments" --method POST --input /tmp/deployment.json --jq .id)',
          'echo "deployment_id=$DEPLOYMENT_ID" >> "$GITHUB_OUTPUT"',
          'echo "Created deployment: $DEPLOYMENT_ID"',
        ].join('\n'),
      },
    ],
  });
}


function addBuildFromMainJob(workflow: GithubWorkflow): void {
  workflow.addJob('build-from-main', {
    needs: ['resolve', 'create-deployment'],
    if: "github.event_name == 'workflow_dispatch'",
    runsOn: ['ubuntu-24.04-arm'],
    permissions: { contents: JobPermission.READ },
    env: {
      CI: 'true',
      PROJECT_NAME: '${{ github.event.repository.name }}',
    },
    steps: [
      {
        name: 'Checkout main (trusted)',
        uses: ACTIONS.checkout,
        with: { ref: 'main' },
      },
      {
        name: 'Setup Node.js',
        uses: ACTIONS.setupNode,
        with: { 'node-version': '20' },
      },
      {
        name: 'Setup .NET',
        uses: ACTIONS.setupDotnet,
        with: { 'dotnet-version': '9.0' },
      },
      { name: 'Enable Corepack', run: 'corepack enable' },
      { name: 'Install dependencies', run: 'yarn install --immutable' },
      { name: 'Build', run: 'npx projen build' },
      {
        name: 'Upload content artifact',
        uses: ACTIONS.uploadArtifact,
        with: {
          'name': 'workshop-content',
          'path': 'dist/content.zip',
          'retention-days': 7,
          'if-no-files-found': 'error',
        },
      },
    ],
  });
}


function addDeployJob(workflow: GithubWorkflow): void {
  workflow.addJob('deploy', {
    needs: ['resolve', 'create-deployment', 'build-from-main'],
    if: "always() && needs.resolve.result == 'success' && needs.create-deployment.result == 'success' && (needs.build-from-main.result == 'success' || needs.build-from-main.result == 'skipped')",
    runsOn: ['ubuntu-latest'],
    permissions: {
      contents: JobPermission.READ,
      idToken: JobPermission.WRITE,
      actions: JobPermission.READ,
    },
    env: {
      CI: 'true',
      PROJECT_NAME: '${{ github.event.repository.name }}',
      BUCKET: '${{ secrets.BUCKET }}',
      AWS_REGION: '${{ secrets.AWS_REGION }}',
      DEPLOYMENT_ROLE: '${{ secrets.DEPLOYMENT_ROLE }}',
    },
    steps: [
      {
        name: 'Checkout main (trusted)',
        uses: ACTIONS.checkout,
        with: { ref: 'main' },
      },
      {
        name: 'Download content artifact (manual dispatch)',
        if: "github.event_name == 'workflow_dispatch'",
        uses: ACTIONS.downloadArtifact,
        with: { name: 'workshop-content', path: 'dist' },
      },
      {
        name: 'Download content artifact (from build run)',
        if: "github.event_name != 'workflow_dispatch'",
        uses: ACTIONS.downloadArtifact,
        with: {
          'name': 'workshop-content',
          'path': 'dist',
          'github-token': '${{ secrets.GITHUB_TOKEN }}',
          'run-id': '${{ needs.resolve.outputs.run_id }}',
        },
      },
      {
        name: 'Configure AWS credentials',
        uses: ACTIONS.configureAwsCreds,
        with: {
          'role-to-assume': '${{ env.DEPLOYMENT_ROLE }}',
          'aws-region': '${{ env.AWS_REGION }}',
          'mask-aws-account-id': true,
        },
      },
      {
        name: 'Deploy workshop to AWS',
        run: 'npx projen deploy',
      },
    ],
  });
}


function addReportDeploymentJob(workflow: GithubWorkflow): void {
  workflow.addJob('report-deployment', {
    needs: ['resolve', 'create-deployment', 'deploy'],
    if: "always() && needs.create-deployment.result == 'success'",
    runsOn: ['ubuntu-latest'],
    permissions: { deployments: JobPermission.WRITE },
    env: { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' },
    steps: [
      {
        name: 'Report deployment status',
        run: [
          'if [ "${{ needs.deploy.result }}" == "success" ]; then',
          '  STATE="success"',
          'else',
          '  STATE="failure"',
          'fi',
          'gh api repos/${{ github.repository }}/deployments/${{ needs.create-deployment.outputs.deployment_id }}/statuses \\',
          '  -f state=$STATE',
          'echo "Deployment status: $STATE"',
        ].join('\n'),
      },
    ],
  });
}
