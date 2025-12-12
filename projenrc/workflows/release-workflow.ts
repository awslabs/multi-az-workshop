/**
 * Release workflow customization
 * Customizes projen's native release workflow to add path filters and attach content.zip
 */

import type { AwsCdkTypeScriptApp } from 'projen/lib/awscdk';

/**
 * Customizes the native release workflow to only run when specific files change
 * and to attach content.zip to the GitHub release
 * @param project The AwsCdkTypeScriptApp project instance
 */
export function customizeReleaseWorkflow(project: AwsCdkTypeScriptApp): void {
  // Get the release workflow from GitHub workflows
  const releaseWorkflow = project.github?.tryFindWorkflow('release');

  if (!releaseWorkflow) {
    console.warn('Release workflow not found. Make sure release is enabled in project configuration.');
    return;
  }

  // Add path filters to the release workflow
  // This ensures the workflow only runs when workshop content changes
  if (releaseWorkflow.file) {
    releaseWorkflow.file.addOverride('on.push.paths', [
      'src/**',
      'content/**',
      'static/**',
      'contentspec.yaml',
    ]);

    // Customize the release_github job to attach content.zip
    // Override the entire steps array to include content.zip in the release
    releaseWorkflow.file.addOverride('jobs.release_github.steps', [
      {
        uses: 'actions/setup-node@v4',
        with: {
          'node-version': 'lts/*',
        },
      },
      {
        name: 'Download build artifacts',
        uses: 'actions/download-artifact@v4',
        with: {
          name: 'build-artifact',
          path: 'dist',
        },
      },
      {
        'name': 'Restore build artifact permissions',
        'run': 'cd dist && setfacl --restore=permissions-backup.acl',
        'continue-on-error': true,
      },
      {
        name: 'Release',
        env: {
          GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
          GITHUB_REPOSITORY: '${{ github.repository }}',
          GITHUB_REF: '${{ github.sha }}',
        },
        run: `
          errout=$(mktemp)
          RELEASE_TAG=$(cat dist/releasetag.txt)
          
          # Check if this is a prerelease by looking for hyphen in tag (e.g., v1.0.0-alpha)
          if [[ "$RELEASE_TAG" == *"-"* ]]; then
            echo "Creating prerelease: $RELEASE_TAG"
            gh release create "$RELEASE_TAG" \\
              -R $GITHUB_REPOSITORY \\
              -F dist/changelog.md \\
              -t "$RELEASE_TAG" \\
              --target $GITHUB_REF \\
              --prerelease \\
              dist/content.zip 2> $errout && true
          else
            echo "Creating release: $RELEASE_TAG"
            gh release create "$RELEASE_TAG" \\
              -R $GITHUB_REPOSITORY \\
              -F dist/changelog.md \\
              -t "$RELEASE_TAG" \\
              --target $GITHUB_REF \\
              dist/content.zip 2> $errout && true
          fi
          
          exitcode=$?
          if [ $exitcode -ne 0 ] && ! grep -q "Release.tag_name already exists" $errout; then
            cat $errout
            exit $exitcode
          fi
        `.trim(),
      },
    ]);
  }
}
