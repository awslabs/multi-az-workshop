// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Release workflow customization
 *
 * Triggers:
 *  - workflow_run on deploy (completed successfully): releases after successful AWS deploy
 *  - push to main with content/static/contentspec changes: releases content-only changes
 *    (a gate job skips if src/** also changed, since deploy handles that path)
 */

import type { AwsCdkTypeScriptApp } from 'projen/lib/awscdk';

export function customizeReleaseWorkflow(project: AwsCdkTypeScriptApp): void {
  const releaseWorkflow = project.github?.tryFindWorkflow('release');

  if (!releaseWorkflow) {
    console.warn('Release workflow not found. Make sure release is enabled in project configuration.');
    return;
  }

  if (releaseWorkflow.file) {
    // Replace triggers
    releaseWorkflow.file.addDeletionOverride('on.push');
    releaseWorkflow.file.addOverride('on.workflow_run', {
      workflows: ['deploy'],
      types: ['completed'],
    });
    releaseWorkflow.file.addOverride('on.push', {
      branches: ['main'],
      paths: [
        'content/**',
        'static/**',
        'contentspec.yaml',
      ],
    });

    // Gate: for workflow_run, require deploy succeeded.
    // For push, require the gate job passed (src/ didn't change).
    releaseWorkflow.file.addOverride(
      'jobs.release.if',
      "(github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success') || (github.event_name == 'push' && needs.gate.outputs.should_release == 'true')",
    );

    // Add gate job dependency
    releaseWorkflow.file.addOverride('jobs.release.needs', ['gate']);

    // Add gate job that checks if src/ changed on push events
    releaseWorkflow.file.addOverride('jobs.gate', {
      'runs-on': 'ubuntu-latest',
      'if': true,
      'outputs': {
        should_release: '${{ steps.check.outputs.should_release }}',
      },
      'permissions': {
        contents: 'read',
      },
      'env': {
        GH_TOKEN: '${{ github.token }}',
      },
      'steps': [
        {
          name: 'Check if src changed',
          id: 'check',
          run: [
            'if [ "${{ github.event_name }}" == "workflow_run" ]; then',
            '  echo "should_release=true" >> "$GITHUB_OUTPUT"',
            '  exit 0',
            'fi',
            '# For push events, skip release if src/ changed (deploy will handle it)',
            'SRC_CHANGED=$(gh api repos/${{ github.repository }}/commits/${{ github.sha }} --jq \'.files[].filename\' | grep "^src/" || true)',
            'if [ -n "$SRC_CHANGED" ]; then',
            '  echo "src/ changed — deploy will trigger release via workflow_run. Skipping."',
            '  echo "should_release=false" >> "$GITHUB_OUTPUT"',
            'else',
            '  echo "Content-only change — proceeding with release."',
            '  echo "should_release=true" >> "$GITHUB_OUTPUT"',
            'fi',
          ].join('\n'),
        },
      ],
    });

    // Override the final release step to attach content.zip and handle prerelease detection
    releaseWorkflow.file.addOverride('jobs.release_github.steps.3.run', `
      errout=$(mktemp)
      RELEASE_TAG=$(cat dist/releasetag.txt)
      
      # Check if this is a prerelease by looking for hyphen in tag (e.g., v1.0.0-alpha)
      if [[ "$RELEASE_TAG" == *"-"* ]]; then
        echo "Creating prerelease: $RELEASE_TAG"
        gh release create "$RELEASE_TAG" \\
          --title "$RELEASE_TAG" \\
          --prerelease \\
          -R $GITHUB_REPOSITORY \\
          -F dist/changelog.md \\
          --target $GITHUB_REF \\
          dist/content.zip 2> $errout && true
      else
        echo "Creating release: $RELEASE_TAG"
        gh release create "$RELEASE_TAG" \\
          --title "$RELEASE_TAG" \\
          -R $GITHUB_REPOSITORY \\
          -F dist/changelog.md \\
          --target $GITHUB_REF \\
          dist/content.zip 2> $errout && true
      fi
      
      exitcode=$?
      if [ $exitcode -ne 0 ] && ! grep -q "Release.tag_name already exists" $errout; then
        cat $errout
        exit $exitcode
      fi
    `.trim());
  }
}
