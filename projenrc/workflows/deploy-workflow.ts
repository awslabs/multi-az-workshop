// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Deploy workflow configuration
 * Deploys to AWS once a PR has been approved AND all required checks pass.
 * Triggered by:
 *  - pull_request_review (submitted, approved) — gates on human approval
 *  - workflow_dispatch — manual deploys from main
 * Concurrency ensures only one deploy per PR head SHA is active at a time,
 * cancelling in-flight runs when a newer commit supersedes them.
 */

import { GithubWorkflow } from 'projen/lib/github';
import type { GitHub } from 'projen/lib/github';
import { JobPermission } from 'projen/lib/github/workflows-model';

export function createDeployWorkflow(github: GitHub): void {
  const deployWorkflow = new GithubWorkflow(github, 'deploy');

  deployWorkflow.on({
    workflowDispatch: {},
    pullRequestReview: {
      types: ['submitted'],
    },
  });

  // One active deploy per ref (PR head SHA or main). Newer runs cancel older ones.
  deployWorkflow.file?.addOverride('concurrency', {
    group: 'deploy-${{ github.event.pull_request.head.sha || github.sha }}',
    'cancel-in-progress': true,
  });

  // Job 1: Resolve the ref to deploy and verify prerequisites
  deployWorkflow.addJob('check-changes', {
    runsOn: ['ubuntu-latest'],
    // Only approved reviews or manual dispatches proceed.
    if: "github.event_name == 'workflow_dispatch' || (github.event_name == 'pull_request_review' && github.event.review.state == 'approved')",
    permissions: {
      checks: JobPermission.READ,
      actions: JobPermission.READ,
      contents: JobPermission.READ,
    },
    outputs: {
      should_deploy: { stepId: 'check', outputName: 'should_deploy' },
      ref: { stepId: 'check', outputName: 'ref' },
    },
    env: {
      GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
    },
    steps: [
      {
        name: 'Determine ref',
        id: 'check',
        run: `
          if [ "\${{ github.event_name }}" == "workflow_dispatch" ]; then
            echo "Manual trigger - deploying from main"
            echo "ref=main" >> $GITHUB_OUTPUT
          else
            echo "Triggered by PR approval"
            echo "ref=\${{ github.event.pull_request.head.sha }}" >> $GITHUB_OUTPUT
          fi
          echo "should_deploy=true" >> $GITHUB_OUTPUT
        `.trim(),
      },
      {
        name: 'Verify all required checks passed for this ref',
        if: "github.event_name == 'pull_request_review'",
        run: `
          SHA="\${{ github.event.pull_request.head.sha }}"
          echo "Verifying checks for $SHA"

          # Fetch all check runs for this SHA
          CHECK_RUNS=$(gh api repos/\${{ github.repository }}/commits/$SHA/check-runs --paginate \\
            --jq '[.check_runs[]] | group_by(.name) | map(sort_by(.started_at) | reverse | .[0])')

          FAILED=$(echo "$CHECK_RUNS" | jq '[.[] | select(.conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out")] | length')
          PENDING=$(echo "$CHECK_RUNS" | jq '[.[] | select(.status != "completed" and .name != "deploy" and .name != "check-changes" and .name != "create-deployment" and .name != "build" and .name != "report-deployment")] | length')

          echo "Failed checks: $FAILED"
          echo "Pending checks (excluding this deploy workflow): $PENDING"

          if [ "$FAILED" -gt 0 ]; then
            echo "::error::One or more required checks failed for $SHA. Refusing to deploy."
            echo "$CHECK_RUNS" | jq -r '.[] | select(.conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out") | "- \\(.name): \\(.conclusion)"'
            exit 1
          fi

          if [ "$PENDING" -gt 0 ]; then
            echo "::error::Required checks are still pending for $SHA. Refusing to deploy."
            echo "$CHECK_RUNS" | jq -r '.[] | select(.status != "completed") | "- \\(.name): \\(.status)"'
            exit 1
          fi

          echo "All required checks passed for $SHA"
        `.trim(),
      },
    ],
  });

  // Job 2: Create GitHub deployment
  deployWorkflow.addJob('create-deployment', {
    needs: ['check-changes'],
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
    },
    steps: [
      {
        name: 'Create deployment',
        id: 'create',
        run: `
          DEPLOYMENT_ID=$(gh api repos/\${{ github.repository }}/deployments \\
            -f ref=\${{ needs.check-changes.outputs.ref }} \\
            -f environment=AWS \\
            -F auto_merge=false \\
            --jq '.id')
          echo "deployment_id=$DEPLOYMENT_ID" >> $GITHUB_OUTPUT
          echo "Created deployment: $DEPLOYMENT_ID"
        `.trim(),
      },
    ],
  });

  // Job 3: Build content
  deployWorkflow.addJob('build', {
    needs: ['check-changes', 'create-deployment'],
    if: 'needs.check-changes.outputs.should_deploy == \'true\'',
    runsOn: ['ubuntu-24.04-arm'],
    permissions: {
      contents: JobPermission.READ,
    },
    env: {
      CI: 'true',
      PROJECT_NAME: '${{ github.event.repository.name }}',
      AWS_REGION: '${{ secrets.AWS_REGION }}',
    },
    steps: [
      {
        name: 'Checkout',
        uses: 'actions/checkout@v4',
        with: { ref: '${{ needs.check-changes.outputs.ref }}' },
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
      { name: 'Build workshop content', run: 'npx projen build' },
      {
        name: 'Upload content artifact',
        uses: 'actions/upload-artifact@v4',
        with: {
          'name': 'workshop-content',
          'path': 'dist/content.zip',
          'retention-days': 7,
        },
      },
    ],
  });

  // Job 4: Deploy to AWS
  deployWorkflow.addJob('deploy', {
    needs: ['check-changes', 'create-deployment', 'build'],
    if: 'needs.check-changes.outputs.should_deploy == \'true\'',
    runsOn: ['ubuntu-latest'],
    permissions: {
      contents: JobPermission.READ,
      idToken: JobPermission.WRITE,
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
        name: 'Checkout',
        uses: 'actions/checkout@v4',
        with: { ref: '${{ needs.check-changes.outputs.ref }}' },
      },
      {
        name: 'Setup Node.js',
        uses: 'actions/setup-node@v4',
        with: { 'node-version': '20' },
      },
      { name: 'Enable Corepack', run: 'corepack enable' },
      { name: 'Install dependencies', run: 'yarn install --immutable' },
      {
        name: 'Download content artifact',
        uses: 'actions/download-artifact@v4',
        with: { name: 'workshop-content', path: 'dist' },
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
      { name: 'Deploy workshop to AWS', run: 'npx projen deploy' },
    ],
  });

  // Job 5: Report deployment status
  deployWorkflow.addJob('report-deployment', {
    needs: ['check-changes', 'create-deployment', 'build', 'deploy'],
    if: 'always() && needs.create-deployment.result == \'success\'',
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
