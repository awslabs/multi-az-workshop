#!/bin/bash

# Enhanced CI Debugging Script for CDK Asset Hash Stability
# This script captures detailed git blob SHA information during CI builds

DEBUG_FILE="enhanced-debug-output.txt"

log_with_timestamp() {
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")] $1" | tee -a "$DEBUG_FILE"
}

log_with_timestamp "=== ENHANCED CI DEBUGGING START ==="

# Capture git repository state
log_with_timestamp "=== GIT REPOSITORY STATE ==="
log_with_timestamp "Current branch: $(git rev-parse --abbrev-ref HEAD)"
log_with_timestamp "Current commit: $(git rev-parse HEAD)"
log_with_timestamp "Short commit: $(git rev-parse --short HEAD)"
log_with_timestamp "Commit message: $(git log -1 --pretty=%B | head -1)"
log_with_timestamp "Commit author: $(git log -1 --pretty=%an)"
log_with_timestamp "Commit date: $(git log -1 --pretty=%ci)"

# Check working directory status before build
log_with_timestamp "=== PRE-BUILD WORKING DIRECTORY STATUS ==="
if git diff --quiet && git diff --cached --quiet; then
    log_with_timestamp "Working directory: clean"
else
    log_with_timestamp "Working directory: has changes"
    MODIFIED_FILES=$(git diff --name-only)
    if [ ! -z "$MODIFIED_FILES" ]; then
        log_with_timestamp "Modified files: $MODIFIED_FILES"
    fi
    STAGED_FILES=$(git diff --cached --name-only)
    if [ ! -z "$STAGED_FILES" ]; then
        log_with_timestamp "Staged files: $STAGED_FILES"
    fi
fi

# Capture blob SHA of static template before build
if [ -f "static/multi-az-workshop.json" ]; then
    STATIC_BLOB_SHA_PRE=$(git hash-object static/multi-az-workshop.json)
    COMMITTED_BLOB_SHA=$(git rev-parse HEAD:static/multi-az-workshop.json 2>/dev/null || echo "not_found")
    log_with_timestamp "Static template blob SHA (pre-build): $STATIC_BLOB_SHA_PRE"
    log_with_timestamp "Committed static template blob SHA: $COMMITTED_BLOB_SHA"
    log_with_timestamp "Static template matches committed (pre-build): $([ "$STATIC_BLOB_SHA_PRE" = "$COMMITTED_BLOB_SHA" ] && echo "YES" || echo "NO")"
fi

# Run the build (this should be called from the main workflow)
log_with_timestamp "=== RUNNING BUILD ==="
log_with_timestamp "Build command will be executed by caller..."

# This function should be called after the build completes
analyze_post_build() {
    log_with_timestamp "=== POST-BUILD ANALYSIS ==="
    
    # Capture blob SHA of static template after build
    if [ -f "static/multi-az-workshop.json" ]; then
        STATIC_BLOB_SHA_POST=$(git hash-object static/multi-az-workshop.json)
        log_with_timestamp "Static template blob SHA (post-build): $STATIC_BLOB_SHA_POST"
        log_with_timestamp "Static template changed during build: $([ "$STATIC_BLOB_SHA_PRE" != "$STATIC_BLOB_SHA_POST" ] && echo "YES" || echo "NO")"
    fi
    
    # Capture blob SHA of generated template
    if [ -f "cdk.out/multi-az-workshop.template.json" ]; then
        GENERATED_BLOB_SHA=$(git hash-object cdk.out/multi-az-workshop.template.json)
        log_with_timestamp "Generated template blob SHA: $GENERATED_BLOB_SHA"
        
        if [ -f "static/multi-az-workshop.json" ]; then
            STATIC_BLOB_SHA_CURRENT=$(git hash-object static/multi-az-workshop.json)
            log_with_timestamp "Generated vs Static blob SHA match: $([ "$GENERATED_BLOB_SHA" = "$STATIC_BLOB_SHA_CURRENT" ] && echo "YES" || echo "NO")"
        fi
    fi
    
    # Stage files and analyze what git diff --staged would see
    log_with_timestamp "=== GIT DIFF STAGED ANALYSIS ==="
    git add .
    
    # Check if there are any staged changes
    if git diff --staged --quiet; then
        log_with_timestamp "No staged changes detected"
    else
        log_with_timestamp "Staged changes detected!"
        
        # Get list of changed files
        CHANGED_FILES=$(git diff --staged --name-only)
        log_with_timestamp "Changed files: $CHANGED_FILES"
        
        # Focus on static template if it changed
        if echo "$CHANGED_FILES" | grep -q "static/multi-az-workshop.json"; then
            log_with_timestamp "=== STATIC TEMPLATE CHANGE ANALYSIS ==="
            
            # Get old and new blob SHAs
            OLD_BLOB_SHA=$(git rev-parse HEAD:static/multi-az-workshop.json 2>/dev/null || echo "not_found")
            NEW_BLOB_SHA=$(git hash-object static/multi-az-workshop.json)
            
            log_with_timestamp "Old blob SHA (HEAD): $OLD_BLOB_SHA"
            log_with_timestamp "New blob SHA (staged): $NEW_BLOB_SHA"
            log_with_timestamp "Blob SHA changed: $([ "$OLD_BLOB_SHA" != "$NEW_BLOB_SHA" ] && echo "YES" || echo "NO")"
            
            # Get diff statistics
            DIFF_STATS=$(git diff --staged --stat static/multi-az-workshop.json)
            log_with_timestamp "Diff stats: $DIFF_STATS"
            
            # Extract changed asset hashes
            log_with_timestamp "=== ASSET HASH CHANGES ==="
            ASSET_HASH_CHANGES=$(git diff --staged static/multi-az-workshop.json | grep -E "[\+\-].*[a-f0-9]{64}\.json" | head -10)
            if [ ! -z "$ASSET_HASH_CHANGES" ]; then
                log_with_timestamp "Asset hash changes found:"
                echo "$ASSET_HASH_CHANGES" | while read -r line; do
                    log_with_timestamp "  $line"
                done
                
                # Analyze first changed hash in detail
                FIRST_CHANGED_HASH=$(echo "$ASSET_HASH_CHANGES" | head -1 | grep -oE "[a-f0-9]{64}" | head -1)
                if [ ! -z "$FIRST_CHANGED_HASH" ]; then
                    log_with_timestamp "=== DETAILED ANALYSIS OF HASH: $FIRST_CHANGED_HASH ==="
                    
                    # Check if this hash exists in the asset manifest
                    if [ -f "cdk.out/multi-az-workshop.assets.json" ]; then
                        ASSET_INFO=$(cat cdk.out/multi-az-workshop.assets.json | jq -r ".files[\"$FIRST_CHANGED_HASH\"] // empty" 2>/dev/null)
                        if [ ! -z "$ASSET_INFO" ] && [ "$ASSET_INFO" != "null" ]; then
                            log_with_timestamp "Asset found in manifest: $ASSET_INFO"
                            
                            ASSET_PATH=$(echo "$ASSET_INFO" | jq -r ".source.path // empty")
                            DISPLAY_NAME=$(echo "$ASSET_INFO" | jq -r ".displayName // empty")
                            
                            log_with_timestamp "Asset display name: $DISPLAY_NAME"
                            log_with_timestamp "Asset source path: $ASSET_PATH"
                            
                            # Check if asset file exists and get its blob SHA
                            if [ -f "cdk.out/$ASSET_PATH" ]; then
                                ASSET_BLOB_SHA=$(git hash-object "cdk.out/$ASSET_PATH")
                                log_with_timestamp "Asset file blob SHA: $ASSET_BLOB_SHA"
                                log_with_timestamp "Asset hash matches file hash: $([ "$FIRST_CHANGED_HASH" = "$ASSET_BLOB_SHA" ] && echo "YES" || echo "NO")"
                                
                                # Get file stats
                                ASSET_SIZE=$(stat -c%s "cdk.out/$ASSET_PATH" 2>/dev/null || stat -f%z "cdk.out/$ASSET_PATH" 2>/dev/null || echo "unknown")
                                ASSET_MTIME=$(stat -c%y "cdk.out/$ASSET_PATH" 2>/dev/null || stat -f%Sm "cdk.out/$ASSET_PATH" 2>/dev/null || echo "unknown")
                                log_with_timestamp "Asset file size: $ASSET_SIZE bytes"
                                log_with_timestamp "Asset file mtime: $ASSET_MTIME"
                            else
                                log_with_timestamp "Asset file not found: cdk.out/$ASSET_PATH"
                            fi
                        else
                            log_with_timestamp "Asset hash not found in current manifest"
                        fi
                    else
                        log_with_timestamp "Asset manifest not found"
                    fi
                fi
            else
                log_with_timestamp "No asset hash changes found in diff"
            fi
            
            # Show a sample of the actual diff
            log_with_timestamp "=== DIFF SAMPLE (first 20 lines) ==="
            git diff --staged static/multi-az-workshop.json | head -20 | while read -r line; do
                log_with_timestamp "  $line"
            done
        fi
        
        # Generate the patch file that would cause the build to fail
        git diff --staged --patch > repo.patch
        PATCH_SIZE=$(wc -c < repo.patch)
        log_with_timestamp "Generated repo.patch size: $PATCH_SIZE bytes"
        
        # Show patch stats
        PATCH_STATS=$(git diff --staged --stat)
        log_with_timestamp "Patch stats: $PATCH_STATS"
    fi
    
    log_with_timestamp "=== ENHANCED CI DEBUGGING COMPLETE ==="
}

# Export the function so it can be called from the workflow
export -f analyze_post_build
export DEBUG_FILE
export -f log_with_timestamp

# If this script is run directly (not sourced), run the post-build analysis
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    analyze_post_build
fi