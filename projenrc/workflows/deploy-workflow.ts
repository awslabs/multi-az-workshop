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
  });

  workflow.file?.addOverride('concurrency', {
    group: 'deploy-${{ github.event.workflow_run.head_sha || github.sha }}',
    'cancel-in-progress': true,
  });

  const authorAllowlist = TRUSTED_AUTHORS
    .map((u) => `github.event.workflow_run.actor.login == '${u}' || github.event.workflow_run.triggering_actor.login == '${u}'`)
    .join(' || ');

  const gate = `github.event_name == 'workflow_dispatch' || (github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'pull_request' && (${authorAllowlist}))`;

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
    },
    outputs: {
      ref: { stepId: 'info', outputName: 'ref' },
      run_id: { stepId: 'info', outputName: 'run_id' },
    },
    steps: [
      {
        name: 'Determine ref and source run',
        id: 'info',
        run: `
          if [ "\${{ github.event_name }}" == "workflow_dispatch" ]; then
            echo "Manual trigger - deploying from main"
            echo "ref=main" >> $GITHUB_OUTPUT
            echo "run_id=" >> $GITHUB_OUTPUT
          else
            echo "Triggered by build run \${{ github.event.workflow_run.id }}"
            echo "ref=\${{ github.event.workflow_run.head_sha }}" >> $GITHUB_OUTPUT
            echo "run_id=\${{ github.event.workflow_run.id }}" >> $GITHUB_OUTPUT
          fi
        `.trim(),
      },
    ],
  });
}

function addCreateDeploymentJob(workflow: GithubWorkflow): void {
  workflow.addJob('create-deployment', {
    needs: ['resolve'],
    runsOn: ['ubuntu-latest'],
    permissions: {
      contents: JobPermission.READ,
      deployments: JobPermission.WRITE,
    },
    outputs: {
      deployment_id: { stepId: 'create', outputName: 'deployment_id' },
    },
    env: { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' },
    steps: [
      {
        name: 'Create deployment',
        id: 'create',
        run: `
          DEPLOYMENT_ID=$(gh api repos/\${{ github.repository }}/deployments \\
            -f ref=\${{ needs.resolve.outputs.ref }} \\
            -f environment=AWS \\
            -F auto_merge=false \\
            -F required_contexts='[]' \\
            --jq '.id')
          echo "deployment_id=$DEPLOYMENT_ID" >> $GITHUB_OUTPUT
          echo "Created deployment: $DEPLOYMENT_ID"
        `.trim(),
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
        uses: 'actions/upload-artifact@v4',
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
        // Same-run artifact produced by build-from-main.
        name: 'Download content artifact (manual dispatch)',
        if: "github.event_name == 'workflow_dispatch'",
        uses: 'actions/download-artifact@v4',
        with: { name: 'workshop-content', path: 'dist' },
      },
      {
        // Cross-run artifact from the triggering build workflow run.
        name: 'Download content artifact (from build run)',
        if: "github.event_name == 'workflow_run'",
        uses: 'actions/download-artifact@v4',
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
        // Run deploy via projen task executor from npm without installing the
        // full project. Only needs awscli + unzip which are preinstalled on the
        // runner, so we invoke the underlying script inline.
        name: 'Deploy workshop to AWS',
        run: `
          set -euo pipefail
          rm -rf tmp && mkdir -p tmp
          unzip -q dist/content.zip -d tmp

          ASSETS_PREFIX=$(date --utc +"%Y-%m-%dT%H-%M-%SZ")
          echo "$ASSETS_PREFIX" > tmp/assets_prefix.txt

          echo "Uploading assets to s3://$BUCKET/$ASSETS_PREFIX/"
          aws s3 cp tmp "s3://$BUCKET/$ASSETS_PREFIX/" --recursive

          set +e
          aws cloudformation describe-stacks --stack-name "$PROJECT_NAME" --region "$AWS_REGION" >/dev/null 2>&1
          EXISTS=$?
          set -e

          if [ $EXISTS -eq 0 ]; then
            CHANGE_SET_TYPE=UPDATE; WAIT=update
          else
            CHANGE_SET_TYPE=CREATE; WAIT=create
          fi
          echo "Stack $CHANGE_SET_TYPE"

          aws cloudformation create-change-set \\
            --change-set-type "$CHANGE_SET_TYPE" \\
            --stack-name "$PROJECT_NAME" \\
            --change-set-name "$PROJECT_NAME-$ASSETS_PREFIX" \\
            --template-url "https://$BUCKET.s3.$AWS_REGION.amazonaws.com/$ASSETS_PREFIX/$PROJECT_NAME.json" \\
            --parameters \\
              ParameterKey=AssetsBucketName,ParameterValue="$BUCKET" \\
              ParameterKey=AssetsBucketPrefix,ParameterValue="$ASSETS_PREFIX/" \\
              ParameterKey=ParticipantRoleName,ParameterValue=Admin \\
            --capabilities CAPABILITY_IAM \\
            --region "$AWS_REGION"

          aws cloudformation wait change-set-create-complete \\
            --stack-name "$PROJECT_NAME" \\
            --change-set-name "$PROJECT_NAME-$ASSETS_PREFIX" \\
            --region "$AWS_REGION"

          INITIAL_STATUS=$(aws cloudformation describe-stacks --stack-name "$PROJECT_NAME" --region "$AWS_REGION" --query 'Stacks[0].StackStatus' --output text)

          aws cloudformation execute-change-set \\
            --stack-name "$PROJECT_NAME" \\
            --change-set-name "$PROJECT_NAME-$ASSETS_PREFIX" \\
            --region "$AWS_REGION"

          while true; do
            STATUS=$(aws cloudformation describe-stacks --stack-name "$PROJECT_NAME" --region "$AWS_REGION" --query 'Stacks[0].StackStatus' --output text)
            if [ "$STATUS" != "$INITIAL_STATUS" ]; then
              echo "Stack transitioned to: $STATUS"
              break
            fi
            sleep 5
          done

          if ! aws cloudformation wait "stack-$WAIT-complete" --stack-name "$PROJECT_NAME" --region "$AWS_REGION"; then
            echo "Deployment failed - cleaning up S3 prefix"
            aws s3 rm "s3://$BUCKET/$ASSETS_PREFIX/" --recursive || true
            exit 1
          fi

          echo "Deployment succeeded - cleaning up old S3 content"
          aws s3 rm "s3://$BUCKET/" --recursive --exclude "$ASSETS_PREFIX/*" || true
        `.trim(),
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
