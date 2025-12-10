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
  echo "=== MUTATION DETECTED ===" | tee -a debug-output.txt
  echo "Files changed during build:" | tee -a debug-output.txt
  git diff --staged --name-only | tee -a debug-output.txt
  echo "" | tee -a debug-output.txt
  echo "=== CDK VERSION INFO ===" | tee -a debug-output.txt
  npx cdk --version | tee -a debug-output.txt || echo "Failed to get CDK version" | tee -a debug-output.txt
  echo "" | tee -a debug-output.txt
  echo "=== ASSETS.JSON CONTENT ===" | tee -a debug-output.txt
  if [ -f "cdk.out/multi-az-workshop.assets.json" ]; then
    echo "Contents of cdk.out/multi-az-workshop.assets.json:" | tee -a debug-output.txt
    cat cdk.out/multi-az-workshop.assets.json | tee -a debug-output.txt
  else
    echo "assets.json file not found at cdk.out/multi-az-workshop.assets.json" | tee -a debug-output.txt
  fi
  echo "" | tee -a debug-output.txt
  echo "=== STATIC TEMPLATE CHANGES ===" | tee -a debug-output.txt
  if git diff --staged --name-only | grep -q "static/multi-az-workshop.json"; then
    echo "Extracting changed asset hashes from static/multi-az-workshop.json:" | tee -a debug-output.txt
    git diff --staged static/multi-az-workshop.json | grep -E "[\\+\\-].*[a-f0-9]{64}\\.json" | head -10 | tee -a debug-output.txt
    echo "" | tee -a debug-output.txt
    echo "=== FIRST CHANGED ASSET HASH DETAILS ===" | tee -a debug-output.txt
    CHANGED_HASH=$(git diff --staged static/multi-az-workshop.json | grep -E "[\\+\\-].*[a-f0-9]{64}\\.json" | head -1 | grep -oE "[a-f0-9]{64}" | head -1)
    if [ ! -z "$CHANGED_HASH" ]; then
      echo "Changed asset hash: $CHANGED_HASH" | tee -a debug-output.txt
      echo "Looking up asset in manifest file..." | tee -a debug-output.txt
      if [ -f "cdk.out/multi-az-workshop.assets.json" ]; then
        ASSET_PATH=$(cat cdk.out/multi-az-workshop.assets.json | jq -r ".files[\\"$CHANGED_HASH\\"].source.path // empty")
        if [ ! -z "$ASSET_PATH" ]; then
          ASSET_FILE="cdk.out/$ASSET_PATH"
          echo "Asset source file: $ASSET_FILE" | tee -a debug-output.txt
          if [ -f "$ASSET_FILE" ]; then
            echo "Content of newly generated $ASSET_FILE:" | tee -a debug-output.txt
            cat "$ASSET_FILE" >> debug-output.txt
            echo "" | tee -a debug-output.txt
            echo "=== COMPARISON WITH COMMITTED VERSION ===" | tee -a debug-output.txt
            OLD_HASH=$(git show HEAD:static/multi-az-workshop.json | grep -oE "[a-f0-9]{64}\\.json" | head -1 | grep -oE "[a-f0-9]{64}")
            if [ ! -z "$OLD_HASH" ] && [ "$OLD_HASH" != "$CHANGED_HASH" ]; then
              echo "Previous committed asset hash: $OLD_HASH" | tee -a debug-output.txt
              OLD_ASSET_PATH=$(cat cdk.out/multi-az-workshop.assets.json | jq -r ".files[\\"$OLD_HASH\\"].source.path // empty")
              if [ ! -z "$OLD_ASSET_PATH" ]; then
                OLD_ASSET_FILE="cdk.out/$OLD_ASSET_PATH"
                echo "Previous asset source file: $OLD_ASSET_FILE" | tee -a debug-output.txt
                if [ -f "$OLD_ASSET_FILE" ]; then
                  echo "Content of previous version $OLD_ASSET_FILE:" | tee -a debug-output.txt
                  cat "$OLD_ASSET_FILE" >> debug-output.txt
                else
                  echo "Previous asset file $OLD_ASSET_FILE not found in current cdk.out/" | tee -a debug-output.txt
                fi
              else
                echo "Previous asset hash $OLD_HASH not found in current manifest" | tee -a debug-output.txt
              fi
            fi
          else
            echo "Asset file $ASSET_FILE not found" | tee -a debug-output.txt
          fi
        else
          echo "Asset hash $CHANGED_HASH not found in manifest" | tee -a debug-output.txt
        fi
      else
        echo "Asset manifest file not found" | tee -a debug-output.txt
      fi
      fi
    fi
  fi
fi`);

  // Add a step to upload the debug output as an artifact
  buildWorkflow.file?.addOverride('jobs.build.steps.5', {
    name: 'Upload debug output',
    if: 'steps.self_mutation.outputs.self_mutation_happened',
    uses: 'actions/upload-artifact@v4.4.0',
    with: {
      name: 'debug-output.txt',
      path: 'debug-output.txt',
      overwrite: true,
    },
  });

  // The test tasks have their own AWS environment variables configured
  // No job-level environment variables needed since they might affect CDK synthesis
}