// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Deploy workflow configuration
 *
 * Triggered by:
 *  - workflow_run (build completed) for PR validation pre-merge
 *  - workflow_dispatch for manual deploys from main
 *
 * Security model:
 *   Deploy is privileged (holds AWS credentials). To avoid
 *   actions/untrusted-checkout, we never check out PR source in the privileged
 *   context. The `build` workflow builds PR code unprivileged and publishes
 *   dist/content.zip as an artifact. On workflow_run, we fetch that artifact.
 *   On workflow_dispatch, a separate job checks out main (trusted) and builds
 *   dist/content.zip. The deploy job itself only runs aws CLI against the
 *   pre-built artifact — no PR-controlled code executes in the privileged
 *   context.
 */

import { GithubWorkflow } from 'projen/lib/github';
import type { GitHub } from 'projen/lib/github';
import { JobPermission } from 'projen/lib/github/workflows-model';

const TRUSTED_AUTHORS = ['hakenmt', 'github-actions[bot]'];

export function createDeployWorkflow(github: GitHub): void {
  const workflow = new GithubWorkflow(github, 'deploy');

  workflow.on({
    workflowDispatch: {},
    workflowRun: { workflows: ['build'], types: ['completed'] },
    pullRequestReview: { types: ['submitted'] },
  });

  workflow.file?.addOverride('concurrency', {
    // Key by the head SHA across all trigger types. For pull_request_review,
    // that's pull_request.head.sha; for workflow_run, workflow_run.head_sha;
    // for workflow_dispatch, just github.sha (main).
    'group': 'deploy-${{ github.event.workflow_run.head_sha || github.event.pull_request.head.sha || github.sha }}',
    'cancel-in-progress': true,
  });

  const runActor = 'github.event.workflow_run.actor.login';
  const runTriggerer = 'github.event.workflow_run.triggering_actor.login';
  const prAuthor = 'github.event.pull_request.user.login';

  const authorAllowlist = TRUSTED_AUTHORS
    .map((u) => `${runActor} == '${u}' || ${runTriggerer} == '${u}' || ${prAuthor} == '${u}'`)
    .join(' || ');

  // Entry gate: drop events from untrusted actors or non-applicable trigger
  // shapes before doing anything else.
  const gate = [
    "github.event_name == 'workflow_dispatch'",
    `(github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'pull_request' && (${authorAllowlist}))`,
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
          'set -euo pipefail',
          'if [ "${{ github.event_name }}" == "workflow_dispatch" ]; then',
          '  echo "Manual trigger - deploying from main"',
          '  echo "ref=main" >> "$GITHUB_OUTPUT"',
          'elif [ "${{ github.event_name }}" == "workflow_run" ]; then',
          '  echo "Triggered by build run ${{ github.event.workflow_run.id }}"',
          '  echo "ref=${{ github.event.workflow_run.head_sha }}" >> "$GITHUB_OUTPUT"',
          'else',
          '  echo "Triggered by PR review on #${{ github.event.pull_request.number }}"',
          '  echo "ref=${{ github.event.pull_request.head.sha }}" >> "$GITHUB_OUTPUT"',
          'fi',
        ].join('\n'),
      },
      {
        // Determines build_ok and the build run_id for artifact download.
        // - workflow_dispatch: no build needed; run_id empty
        // - workflow_run: build already succeeded (gate check); run_id from event
        // - pull_request_review: look up latest build run for head SHA and verify success
        name: 'Check build status',
        id: 'build_check',
        run: [
          'set -euo pipefail',
          'if [ "${{ github.event_name }}" == "workflow_dispatch" ]; then',
          '  echo "build_ok=true" >> "$GITHUB_OUTPUT"',
          '  echo "run_id=" >> "$GITHUB_OUTPUT"',
          '  exit 0',
          'fi',
          'if [ "${{ github.event_name }}" == "workflow_run" ]; then',
          '  echo "build_ok=true" >> "$GITHUB_OUTPUT"',
          '  echo "run_id=${{ github.event.workflow_run.id }}" >> "$GITHUB_OUTPUT"',
          '  exit 0',
          'fi',
          '# pull_request_review: verify build succeeded for this head SHA',
          'SHA="${{ github.event.pull_request.head.sha }}"',
          'REPO="${{ github.repository }}"',
          'echo "Looking for successful build run for SHA $SHA"',
          'BUILD_RUN=$(gh api "repos/$REPO/actions/workflows/build.yml/runs?head_sha=$SHA" --jq \'[.workflow_runs[]] | sort_by(.run_number) | reverse | first\')',
          'if [ -z "$BUILD_RUN" ] || [ "$BUILD_RUN" = "null" ]; then',
          '  echo "No build run found for $SHA - skipping deploy"',
          '  echo "build_ok=false" >> "$GITHUB_OUTPUT"',
          '  echo "run_id=" >> "$GITHUB_OUTPUT"',
          '  exit 0',
          'fi',
          'CONCLUSION=$(echo "$BUILD_RUN" | jq -r .conclusion)',
          'RUN_ID=$(echo "$BUILD_RUN" | jq -r .id)',
          'echo "Build run $RUN_ID conclusion: $CONCLUSION"',
          'if [ "$CONCLUSION" != "success" ]; then',
          '  echo "Build did not succeed for $SHA - skipping deploy"',
          '  echo "build_ok=false" >> "$GITHUB_OUTPUT"',
          '  echo "run_id=" >> "$GITHUB_OUTPUT"',
          '  exit 0',
          'fi',
          'echo "build_ok=true" >> "$GITHUB_OUTPUT"',
          'echo "run_id=$RUN_ID" >> "$GITHUB_OUTPUT"',
        ].join('\n'),
      },
      {
        name: 'Check PR approval status',
        id: 'approval',
        run: [
          'set -euo pipefail',
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
          'APPROVED=$(gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" --paginate --jq \'[.[] | select(.commit_id == "\'"$SHA"\'")] | group_by(.user.login) | map(sort_by(.submitted_at) | last) | [.[] | select(.state == "APPROVED")] | length\')',
          'echo "Approved reviews for this head SHA: $APPROVED"',
          'if [ "$APPROVED" -ge 1 ]; then',
          '  echo "PR #$PR_NUMBER is approved for SHA $SHA"',
          '  echo "is_approved=true" >> "$GITHUB_OUTPUT"',
          'else',
          '  echo "PR #$PR_NUMBER has no approved review for SHA $SHA - skipping deploy"',
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
    // Only proceed if the resolve job cleared approval and build checks.
    // Unapproved PRs result in this and all downstream jobs being skipped
    // (grey dot), not failed (red X).
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
          'set -euo pipefail',
          'jq -nc --arg ref "$REF" \'{ref: $ref, environment: "AWS", auto_merge: false, required_contexts: []}\' > /tmp/deployment.json',
          'echo "Payload:"; cat /tmp/deployment.json',
          'DEPLOYMENT_ID=$(gh api "repos/$REPO/deployments" --method POST --input /tmp/deployment.json --jq .id)',
          'echo "deployment_id=$DEPLOYMENT_ID" >> "$GITHUB_OUTPUT"',
          'echo "Created deployment: $DEPLOYMENT_ID"',
        ].join('\n'),
      },
    ],
  });
}


// Builds dist/content.zip from main (trusted) on manual dispatch only. Uploads
// the artifact so the deploy job has a uniform input source regardless of trigger.
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
        uses: 'actions/checkout@v4',
        with: { ref: 'main' },
      },
      {
        name: 'Setup Node.js',
        uses: 'actions/setup-node@v4',
        with: { 'node-version': '20' },
      },
      {
        name: 'Setup .NET',
        uses: 'actions/setup-dotnet@v4',
        with: { 'dotnet-version': '9.0' },
      },
      { name: 'Enable Corepack', run: 'corepack enable' },
      { name: 'Install dependencies', run: 'yarn install --immutable' },
      { name: 'Build', run: 'npx projen build' },
      {
        name: 'Upload content artifact',
        uses: 'actions/upload-artifact@v7',
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


// Deploy job. No checkout, no yarn install. Only downloads the pre-built
// artifact (from this run for workflow_dispatch, or from the triggering build
// run for workflow_run) and calls aws CLI against it.
function addDeployJob(workflow: GithubWorkflow): void {
  workflow.addJob('deploy', {
    needs: ['resolve', 'create-deployment', 'build-from-main'],
    // build-from-main is skipped on workflow_run; only fail if it was required
    // and failed. Use always() + explicit skip-aware condition.
    if: "always() && needs.resolve.result == 'success' && needs.create-deployment.result == 'success' && (needs.build-from-main.result == 'success' || needs.build-from-main.result == 'skipped')",
    runsOn: ['ubuntu-latest'],
    permissions: {
      contents: JobPermission.READ,
      idToken: JobPermission.WRITE,
      actions: JobPermission.READ,
    },
    environment: { name: 'AWS' },
    env: {
      CI: 'true',
      PROJECT_NAME: '${{ github.event.repository.name }}',
      BUCKET: '${{ secrets.BUCKET }}',
      AWS_REGION: '${{ secrets.AWS_REGION }}',
      DEPLOYMENT_ROLE: '${{ secrets.DEPLOYMENT_ROLE }}',
    },
    steps: [
      {
        // Checkout main (trusted). We need .projen/tasks.json so npx projen
        // can execute the deploy task. Only trusted code from main runs here;
        // the PR's content.zip is consumed as passive data by the deploy task.
        name: 'Checkout main (trusted)',
        uses: 'actions/checkout@v4',
        with: { ref: 'main' },
      },
      {
        // Same-run artifact produced by build-from-main.
        name: 'Download content artifact (manual dispatch)',
        if: "github.event_name == 'workflow_dispatch'",
        uses: 'actions/download-artifact@v8',
        with: { name: 'workshop-content', path: 'dist' },
      },
      {
        // Cross-run artifact from the build workflow run.
        name: 'Download content artifact (from build run)',
        if: "github.event_name != 'workflow_dispatch'",
        uses: 'actions/download-artifact@v8',
        with: {
          'name': 'workshop-content',
          'path': 'dist',
          'github-token': '${{ secrets.GITHUB_TOKEN }}',
          'run-id': '${{ needs.resolve.outputs.run_id }}',
        },
      },
      {
        name: 'Configure AWS credentials',
        uses: 'aws-actions/configure-aws-credentials@v5.1.0',
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
        run: `
          if [ "\${{ needs.deploy.result }}" == "success" ]; then
            STATE="success"
          else
            STATE="failure"
          fi
          gh api repos/\${{ github.repository }}/deployments/\${{ needs.create-deployment.outputs.deployment_id }}/statuses \\
            -f state=$STATE
          echo "Deployment status: $STATE"
        `.trim(),
      },
    ],
  });
}
