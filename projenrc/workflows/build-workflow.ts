/**
 * Build workflow customization
 * Customizes projen's native build workflow to add AWS_EC2_METADATA_DISABLED environment variable
 */

import type { AwsCdkTypeScriptApp } from 'projen/lib/awscdk';

/**
 * Customizes the native build workflow to add debugging for asset hash mutations
 * @param project The AwsCdkTypeScriptApp project instance
 */
export function customizeBuildWorkflow(project: AwsCdkTypeScriptApp): void {
  // Get the build workflow from GitHub workflows
  const buildWorkflow = project.github?.tryFindWorkflow('build');

  if (!buildWorkflow) {
    console.warn('Build workflow not found. Make sure buildWorkflow is enabled in project configuration.');
    return;
  }

  // Enhance the mutation detection step to capture asset hash differences
  buildWorkflow.file?.addOverride('jobs.build.steps.4.run', `git add .
git diff --staged --patch --exit-code > repo.patch || echo "self_mutation_happened=true" >> $GITHUB_OUTPUT
if [ -f repo.patch ]; then
  echo "=== MUTATION DETECTED ==="
  echo "Files changed during build:"
  git diff --staged --name-only
  echo ""
  echo "=== STATIC TEMPLATE CHANGES ==="
  if git diff --staged --name-only | grep -q "static/multi-az-workshop.json"; then
    echo "Extracting changed asset hashes from static/multi-az-workshop.json:"
    git diff --staged static/multi-az-workshop.json | grep -E "[\\+\\-].*[a-f0-9]{64}\\.json" | head -10
    echo ""
    echo "=== FIRST CHANGED ASSET HASH DETAILS ==="
    CHANGED_HASH=$(git diff --staged static/multi-az-workshop.json | grep -E "[\\+\\-].*[a-f0-9]{64}\\.json" | head -1 | grep -oE "[a-f0-9]{64}" | head -1)
    if [ ! -z "$CHANGED_HASH" ]; then
      echo "Changed asset hash: $CHANGED_HASH"
      echo "Looking for corresponding file in cdk.out/:"
      find cdk.out/ -name "*$CHANGED_HASH*" -type f | head -5
      ASSET_FILE=$(find cdk.out/ -name "*$CHANGED_HASH*" -type f | head -1)
      if [ ! -z "$ASSET_FILE" ]; then
        echo "Content of newly generated $ASSET_FILE (first 50 lines):"
        head -50 "$ASSET_FILE"
        echo ""
        echo "=== COMPARISON WITH COMMITTED VERSION ==="
        OLD_HASH=$(git show HEAD:static/multi-az-workshop.json | grep -oE "[a-f0-9]{64}\\.json" | head -1 | grep -oE "[a-f0-9]{64}")
        if [ ! -z "$OLD_HASH" ] && [ "$OLD_HASH" != "$CHANGED_HASH" ]; then
          echo "Previous committed asset hash: $OLD_HASH"
          OLD_ASSET_FILE=$(find cdk.out/ -name "*$OLD_HASH*" -type f | head -1)
          if [ ! -z "$OLD_ASSET_FILE" ]; then
            echo "Content of previous version $OLD_ASSET_FILE (first 50 lines):"
            head -50 "$OLD_ASSET_FILE"
          else
            echo "Previous asset file not found in current cdk.out/"
          fi
        fi
      fi
    fi
  fi
fi`);

  // The test tasks have their own AWS environment variables configured
  // No job-level environment variables needed since they might affect CDK synthesis
}