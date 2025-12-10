/**
 * Deploy workflow configuration
 * Handles deployment to AWS when changes are pushed to main branch
 */

import { GithubWorkflow } from 'projen/lib/github';
import type { GitHub } from 'projen/lib/github';
import { JobPermission } from 'projen/lib/github/workflows-model';

/**
 * Creates the deploy workflow
 * @param github The GitHub project instance
 */
export function createDeployWorkflow(github: GitHub): void {
  const deployWorkflow = new GithubWorkflow(github, 'deploy');

  deployWorkflow.on({
    workflowRun: {
      workflows: ['review', 'auto-approve'],
      types: [
        'completed',
      ]
    }
  });

  // Job 1: Check if deployment is needed
  deployWorkflow.addJob('check-changes', {
    runsOn: ['ubuntu-latest'],
    permissions: {},
    outputs: {
      should_deploy: {
        stepId: 'check',
        outputName: 'should_deploy',
      },
    },
    steps: [
      {
        name: 'Checkout',
        uses: 'actions/checkout@v4',
        with: {
          'fetch-depth': 2,
        },
      },
      {
        name: 'Check for src changes',
        id: 'check',
        run: `
          if [ "\${{ github.event_name }}" == "workflow_dispatch" ]; then
            echo "Manual trigger - will deploy"
            echo "should_deploy=true" >> $GITHUB_OUTPUT
          elif git diff --name-only HEAD^ HEAD | grep -q "^src/"; then
            echo "Changes detected in src/ - will deploy"
            echo "should_deploy=true" >> $GITHUB_OUTPUT
          else
            echo "No changes in src/ - skipping deployment"
            echo "should_deploy=false" >> $GITHUB_OUTPUT
          fi
        `.trim(),
      },
    ],
  });

  // Job 2: Create GitHub deployment (always runs)
  deployWorkflow.addJob('create-deployment', {
    needs: ['check-changes'],
    runsOn: ['ubuntu-latest'],
    permissions: {
      contents: JobPermission.READ,
      deployments: JobPermission.WRITE,
    },
    environment: {
      name: 'AWS',
    },
    outputs: {
      deployment_id: {
        stepId: 'create',
        outputName: 'deployment_id',
      },
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
            -f ref=\${{ github.sha }} \\
            -f environment=AWS \\
            -F auto_merge=false \\
            --jq '.id')
          echo "deployment_id=$DEPLOYMENT_ID" >> $GITHUB_OUTPUT
          echo "Created deployment: $DEPLOYMENT_ID"
        `.trim(),
      },
    ],
  });

  // Job 3: Bundle and deploy (only runs if there are src changes)
  deployWorkflow.addJob('bundle-and-deploy', {
    needs: ['check-changes', 'create-deployment'],
    if: 'needs.check-changes.outputs.should_deploy == \'true\'',
    runsOn: ['ubuntu-24.04-arm'],
    permissions: {
      contents: JobPermission.READ,
      idToken: JobPermission.WRITE,
    },
    environment: {
      name: 'AWS',
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
        name: 'Checkout',
        uses: 'actions/checkout@v4',
      },
      {
        name: 'Setup Node.js',
        uses: 'actions/setup-node@v4',
        with: {
          'node-version': '20',
        },
      },
      {
        name: 'Setup .NET',
        uses: 'actions/setup-dotnet@v4',
        with: {
          'dotnet-version': '9.0',
        },
      },
      {
        name: 'Install dependencies',
        run: 'npm ci',
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
        name: 'Bundle and deploy workshop',
        run: 'npx projen bundle-and-deploy',
      },
    ],
  });

  // Job 4: Report deployment status (always runs after create-deployment)
  deployWorkflow.addJob('report-deployment', {
    needs: ['check-changes', 'create-deployment', 'bundle-and-deploy'],
    if: 'always() && needs.create-deployment.result != \'skipped\'',
    runsOn: ['ubuntu-latest'],
    permissions: {
      deployments: JobPermission.WRITE,
    },
    environment: {
      name: 'AWS',
    },
    env: {
      GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
    },
    steps: [
      {
        name: 'Report deployment status',
        run: `
          if [ "\${{ needs.check-changes.outputs.should_deploy }}" == "true" ]; then
            if [ "\${{ needs.bundle-and-deploy.result }}" == "success" ]; then
              STATE="success"
            else
              STATE="failure"
            fi
          else
            STATE="success"
            echo "No deployment needed - marking as success"
          fi
          gh api repos/\${{ github.repository }}/deployments/\${{ needs.create-deployment.outputs.deployment_id }}/statuses \\
            -f state=$STATE
          echo "Deployment status: $STATE"
        `.trim(),
      },
    ],
  });
}
