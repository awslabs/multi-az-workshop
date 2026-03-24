/**
 * Auto-approve workflow configuration
 * Automatically approves PRs with the auto-approve label from authorized users.
 * Triggered after the build workflow completes on a PR.
 */

import { GithubWorkflow } from 'projen/lib/github';
import type { GitHub } from 'projen/lib/github';
import { JobPermission } from 'projen/lib/github/workflows-model';

// Centrally defined authorized approvers
export const AUTHORIZED_APPROVERS = ['hakenmt', 'github-bot'];

/**
 * Creates the auto-approve workflow
 * @param github The GitHub project instance
 */
export function createAutoApproveWorkflow(github: GitHub): void {
  const autoApproveWorkflow = new GithubWorkflow(github, 'auto-approve');

  autoApproveWorkflow.on({
    workflowRun: {
      workflows: ['build'],
      types: ['completed'],
    },
  });

  autoApproveWorkflow.addJob('approve', {
    runsOn: ['ubuntu-latest'],
    permissions: {
      pullRequests: JobPermission.WRITE,
      actions: JobPermission.READ,
      checks: JobPermission.READ,
    },
    if: `github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'pull_request'`,
    env: {
      GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
    },
    steps: [
      {
        name: 'Get PR details',
        id: 'pr',
        run: `
          # Get the PR associated with this workflow run
          PR_NUMBER=$(gh api /repos/\${{ github.repository }}/actions/runs/\${{ github.event.workflow_run.id }} \\
            --jq '.pull_requests[0].number')

          if [ -z "$PR_NUMBER" ] || [ "$PR_NUMBER" == "null" ]; then
            echo "No PR found for this workflow run"
            echo "found=false" >> "$GITHUB_OUTPUT"
            exit 0
          fi

          PR_DATA=$(gh api /repos/\${{ github.repository }}/pulls/$PR_NUMBER)
          PR_AUTHOR=$(echo "$PR_DATA" | jq -r '.user.login')
          PR_LABELS=$(echo "$PR_DATA" | jq -r '[.labels[].name] | join(",")')
          PR_SHA=$(echo "$PR_DATA" | jq -r '.head.sha')

          echo "PR #$PR_NUMBER by $PR_AUTHOR with labels: $PR_LABELS"
          echo "found=true" >> "$GITHUB_OUTPUT"
          echo "number=$PR_NUMBER" >> "$GITHUB_OUTPUT"
          echo "author=$PR_AUTHOR" >> "$GITHUB_OUTPUT"
          echo "labels=$PR_LABELS" >> "$GITHUB_OUTPUT"
          echo "sha=$PR_SHA" >> "$GITHUB_OUTPUT"
        `.trim(),
      },
      {
        name: 'Check eligibility',
        id: 'eligible',
        if: "steps.pr.outputs.found == 'true'",
        run: `
          AUTHOR="\${{ steps.pr.outputs.author }}"
          LABELS="\${{ steps.pr.outputs.labels }}"
          AUTHORIZED="${AUTHORIZED_APPROVERS.join(',')}"

          if [[ ",$LABELS," != *",auto-approve,"* ]]; then
            echo "PR does not have auto-approve label"
            echo "eligible=false" >> "$GITHUB_OUTPUT"
            exit 0
          fi

          if [[ ",$AUTHORIZED," != *",$AUTHOR,"* ]]; then
            echo "Author $AUTHOR is not in authorized approvers list"
            echo "eligible=false" >> "$GITHUB_OUTPUT"
            exit 0
          fi

          echo "PR is eligible for auto-approve"
          echo "eligible=true" >> "$GITHUB_OUTPUT"
        `.trim(),
      },
      {
        name: 'Wait for Required Checks to Complete',
        id: 'wait-for-required-checks',
        if: "steps.eligible.outputs.eligible == 'true'",
        env: {
          SHA: '${{ steps.pr.outputs.sha }}',
          TIMEOUT: '600',
          INTERVAL: '10',
        },
        run: `
          START_TIME=$(date +%s)
          SELF_JOB_NAME="approve"

          while true; do
            echo "🔍 Checking status of check runs for $SHA"

            CHECK_RUNS=$(gh api repos/\${{ github.repository }}/commits/$SHA/check-runs --paginate \\
              --jq '[.check_runs[] | select(.name != "'"$SELF_JOB_NAME"'")] | group_by(.name) | map(sort_by(.started_at) | reverse | .[0])')

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
        name: 'Fail If Checks Failed',
        id: 'fail',
        if: "steps.eligible.outputs.eligible == 'true' && steps.wait-for-required-checks.outputs.conclusion != 'success'",
        run: `
          echo "❌ Required checks did not succeed."
          echo "Checks status: \${{ steps.wait-for-required-checks.outputs.conclusion }}"
          exit 1
        `.trim(),
      },
      {
        name: 'Auto-Approve PR',
        id: 'auto-approve',
        uses: 'hmarr/auto-approve-action@v2.2.1',
        if: "steps.eligible.outputs.eligible == 'true' && steps.wait-for-required-checks.outputs.conclusion == 'success'",
        with: {
          'github-token': '${{ secrets.GITHUB_TOKEN }}',
          'pull-request-number': '${{ steps.pr.outputs.number }}',
        },
      },
    ],
  });
}
