/**
 * Publish workflow configuration
 * Handles publishing to Workshop Studio from the latest GitHub release
 */

import { GithubWorkflow } from 'projen/lib/github';
import type { GitHub } from 'projen/lib/github';
import { JobPermission } from 'projen/lib/github/workflows-model';

/**
 * Creates the publish workflow
 * @param github The GitHub project instance
 */
export function createPublishWorkflow(github: GitHub): void {
  const publishWorkflow = new GithubWorkflow(github, 'publish');

  publishWorkflow.on({
    workflowDispatch: {
      inputs: {
        aws_access_key_id: {
          type: 'string',
          description: 'The AWS access key id',
          required: true,
        },
        aws_secret_access_key: {
          type: 'string',
          description: 'The AWS secret access key',
          required: true,
        },
        aws_session_token: {
          type: 'string',
          description: 'The AWS session token',
          required: true,
        },
        email: {
          type: 'string',
          description: 'The email used for the git commit',
          required: true,
        },
      },
    },
  });

  // Job 1: Get latest release, extract content.zip, and upload to S3
  publishWorkflow.addJob('upload-assets', {
    runsOn: ['ubuntu-latest'],
    permissions: {
      contents: JobPermission.READ,
    },
    outputs: {
      release_tag: {
        stepId: 'release-info',
        outputName: 'tag',
      },
      release_sha: {
        stepId: 'release-info',
        outputName: 'sha',
      },
    },
    env: {
      GH_TOKEN: '${{ github.token }}',
      AWS_DEFAULT_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: '${{ inputs.aws_access_key_id }}',
      AWS_SECRET_ACCESS_KEY: '${{ inputs.aws_secret_access_key }}',
      AWS_SESSION_TOKEN: '${{ inputs.aws_session_token }}',
      ASSETS_LOCATION: '${{ secrets.ASSETS_LOCATION }}',
    },
    steps: [
      {
        name: 'Get latest release info',
        id: 'release-info',
        run: `# Get the latest release
RELEASE_INFO=$(gh api repos/\${{ github.repository }}/releases/latest)

RELEASE_TAG=$(echo "$RELEASE_INFO" | jq -r '.tag_name')
RELEASE_SHA=$(echo "$RELEASE_INFO" | jq -r '.target_commitish')

echo "Latest release: $RELEASE_TAG"
echo "Release SHA: $RELEASE_SHA"

echo "tag=$RELEASE_TAG" >> $GITHUB_OUTPUT
echo "sha=$RELEASE_SHA" >> $GITHUB_OUTPUT`,
      },
      {
        name: 'Download content.zip from release',
        run: `# Download the content.zip asset from the latest release
gh release download \${{ steps.release-info.outputs.tag }} \\
  --pattern 'content.zip' \\
  --dir ./`,
      },
      {
        name: 'Extract content.zip',
        run: `mkdir -p extracted
unzip -q content.zip -d extracted`,
      },
      {
        name: 'Upload assets to S3',
        run: 'aws s3 sync extracted "$ASSETS_LOCATION" --delete',
      },
    ],
  });

  // Job 2: Push workshop content to WorkshopStudio
  publishWorkflow.addJob('publish-workshop', {
    needs: ['upload-assets'],
    runsOn: ['ubuntu-latest'],
    permissions: {
      contents: JobPermission.READ,
    },
    env: {
      GH_TOKEN: '${{ github.token }}',
      USER_NAME: '${{ github.triggering_actor }}',
      EMAIL: '${{ inputs.email }}',
      REMOTE_REPO: '${{ secrets.REMOTE_REPO }}',
      AWS_DEFAULT_REGION: 'us-east-1',
      WS_REPO_SOURCE: 's3',
      PLUGIN: '${{ secrets.PLUGIN }}',
      PACKAGE: '${{ secrets.GIT_PACKAGE }}',
      AWS_ACCESS_KEY_ID: '${{ inputs.aws_access_key_id }}',
      AWS_SECRET_ACCESS_KEY: '${{ inputs.aws_secret_access_key }}',
      AWS_SESSION_TOKEN: '${{ inputs.aws_session_token }}',
    },
    steps: [
      {
        name: 'Checkout release SHA',
        uses: 'actions/checkout@v4',
        with: {
          ref: '${{ needs.upload-assets.outputs.release_sha }}',
        },
      },
      {
        name: 'Install git tools',
        run: `pip config set global.trusted-host "$PLUGIN"
pip config set global.extra-index-url https://"$PLUGIN"
pipx install "$PACKAGE"
git config --global user.email "$EMAIL"
git config --global user.name "$USER_NAME"`,
      },
      {
        name: 'Push workshop content',
        run: `# Clone Workshop Studio repository
git clone --branch mainline "$REMOTE_REPO" \${{ github.workspace }}/workshop-repo

cd \${{ github.workspace }}/workshop-repo

# Remove all existing content except .git
find . -path ./.git -prune -o ! -name . ! -name .. -exec rm -rf {} + 2> /dev/null

# Copy content, static, and contentspec.yaml from the checked out release
cp -r \${{ github.workspace }}/content ./
cp -r \${{ github.workspace }}/static ./
cp \${{ github.workspace }}/contentspec.yaml ./

# Check for changes and commit if any exist
set +e
git diff --quiet
if [ $? -eq 1 ]; then
  set -e
  git add -A
  git commit -m "Published from release \${{ needs.upload-assets.outputs.release_tag }}"
  git push
  echo "✅ Workshop content published successfully"
else
  echo "ℹ️ No changes detected, nothing to commit"
fi`,
      },
    ],
  });

}
