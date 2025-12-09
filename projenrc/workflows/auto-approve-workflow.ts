/**
 * Auto-approve workflow configuration
 * Automatically approves PRs with the auto-approve label from authorized users
 */

import { GithubWorkflow } from 'projen/lib/github';
import { JobPermission } from 'projen/lib/github/workflows-model';
import type { GitHub } from 'projen/lib/github';

// Centrally defined authorized approvers
export const AUTHORIZED_APPROVERS = ['hakenmt', 'github-bot'];

/**
 * Creates the auto-approve workflow
 * @param github The GitHub project instance
 */
export function createAutoApproveWorkflow(github: GitHub): void {
  const autoApproveWorkflow = new GithubWorkflow(github, 'auto-approve');
  
  autoApproveWorkflow.on({
    pullRequest: {
      types: [
        'labeled',
        'opened',
        'synchronize',
        'reopened',
        'ready_for_review',
      ],
    },
  });

  autoApproveWorkflow.addJob('approve', {
    runsOn: ['ubuntu-latest'],
    permissions: {
      pullRequests: JobPermission.WRITE,
      actions: JobPermission.READ,
      checks: JobPermission.READ,
    },
    if: `contains(github.event.pull_request.labels.*.name, 'auto-approve') && contains('${AUTHORIZED_APPROVERS.join(',')}', github.event.pull_request.user.login)`,
    env: {
      SHA: '${{ github.event.pull_request.head.sha }}',
      GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
      TIMEOUT: '600',
      INTERVAL: '10',
      WORKFLOW_NAME: 'build',
      TERMINATING_STATUS: 'completed,action_required,cancelled,failure,neutral,skipped,stale,success,timed_out',
    },
    steps: [
      {
        name: 'Wait for Build to Complete',
        id: 'wait-for-build',
        run: `
          START_TIME=$(date +%s)

          while true; do
            # Fetch latest workflow run matching SHA and workflow name
            WORKFLOW_RUN=$(gh api /repos/\${{ github.repository }}/actions/runs \\
            --jq ".workflow_runs | map(select(.head_sha == \\"$SHA\\" and .name == \\"$WORKFLOW_NAME\\")) | first")
            
            if [ -z "$WORKFLOW_RUN" ]; then
              echo "No build workflow run found for commit $SHA."
              echo "conclusion=success" >> "$GITHUB_OUTPUT"
              break
            else
              STATUS=$(echo "$WORKFLOW_RUN" | jq -r '.conclusion')
              RUN_NUMBER=$(echo "$WORKFLOW_RUN" | jq -r '.run_number')
              RUN_ID=$(echo "$WORKFLOW_RUN" | jq -r '.id')
              RUN_ATTEMPT=$(echo "$WORKFLOW_RUN" | jq -r '.run_attempt')
              WORKFLOW_ID=$(echo "$WORKFLOW_RUN" | jq -r '.workflow_id')

              echo "Build SHA: $SHA"
              echo "Build workflow run: $RUN_ID"
              echo "Build workflow status: $STATUS"

              if [[ ",$TERMINATING_STATUS," == *",$STATUS,"* ]]; then
                echo "Build workflow finished with conclusion: $STATUS"
                echo "conclusion=$STATUS" >> "$GITHUB_OUTPUT"
                break
              fi
            fi

            # Check if timeout has been reached
            ELAPSED=$(( $(date +%s) - START_TIME ))
            if [ $ELAPSED -ge $TIMEOUT ]; then
              echo "Timeout reached. Build workflow did not succeed within $TIMEOUT seconds."
              echo "conclusion=timed_out" >> "$GITHUB_OUTPUT"
              break
            fi

            sleep $INTERVAL
          done
        `.trim(),
      },
      {
        name: 'Wait for Required Checks to Complete',
        id: 'wait-for-required-checks',
        run: `
          START_TIME=$(date +%s)

          SELF_JOB_NAME="approve"

          while true; do
            echo "🔍 Checking status of check runs for $SHA"

            CHECK_RUNS=$(gh api repos/\${{ github.repository }}/commits/$SHA/check-runs --paginate \\
              --jq '[.check_runs[] | select(.name != "'"$SELF_JOB_NAME"'")]')

            echo "📋 All check run statuses:"
            echo "$CHECK_RUNS" | jq -r '.[] | "- \\(.name): \\(.status) / \\(.conclusion)"'

            FAILED=$(echo "$CHECK_RUNS" | jq '[.[] | select(.conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out")] | length')
            PENDING=$(echo "$CHECK_RUNS" | jq '[.[] | select(.status != "completed")] | length')

            echo "Pending checks (excluding this job): $PENDING"
            echo "Failed checks: $FAILED"

            if [ "$FAILED" -gt 0 ]; then
              echo "❌ One or more required checks failed."
              echo "conclusion=failure" >> "$GITHUB_OUTPUT"
              break
            fi

            if [ "$PENDING" -eq 0 ]; then
              echo "✅ All required checks (excluding this job) have completed successfully."
              echo "conclusion=success" >> "$GITHUB_OUTPUT"
              break
            else
              echo "⏳ Still waiting on the following checks:"
              echo "$PENDING_CHECKS" | jq -r '.[] | "- \\(.name): \\(.status)"'
            fi

            ELAPSED=$(( $(date +%s) - START_TIME ))
            if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
              echo "⏰ Timeout reached while waiting for checks."
              echo "conclusion=timed_out" >> "$GITHUB_OUTPUT"
              break
            fi

            sleep $INTERVAL
          done
        `.trim(),
      },
      {
        name: 'Fail If Checks or Build Failed',
        id: 'fail',
        if: `steps.wait-for-build.outputs.conclusion != 'success' ||
steps.wait-for-required-checks.outputs.conclusion != 'success'`,
        run: `
          echo "❌ Build or required checks did not succeed."
          echo "Build status: \${{ steps.wait-for-build.outputs.conclusion }}"
          echo "Checks status: \${{ steps.wait-for-required-checks.outputs.conclusion }}"
          exit 1
        `.trim(),
      },
      {
        name: 'Auto-Approve PR',
        id: 'auto-approve',
        uses: 'hmarr/auto-approve-action@v2.2.1',
        if: 'contains(\'success,neutral,skipped\', steps.wait-for-build.outputs.conclusion)',
        with: {
          'github-token': '${{ secrets.GITHUB_TOKEN }}',
        },
      },
    ],
  });
}
