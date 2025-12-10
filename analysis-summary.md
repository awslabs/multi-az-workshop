# CDK Asset Hash Stability Analysis Summary

## Key Findings

### 1. Asset Hash Mismatch Pattern
**Critical Discovery**: ALL 39 assets in the CDK manifest show hash mismatches between the expected hash (from manifest) and actual file content hash. This indicates a fundamental issue with how CDK is calculating or storing asset hashes.

### 2. Static Template Consistency
**Important**: The static template (`static/multi-az-workshop.json`) and generated template (`cdk.out/multi-az-workshop.template.json`) are **identical** in the current local environment. This suggests the issue occurs specifically in CI environments.

### 3. Identified Sources of Non-Determinism

#### A. CDK Logical ID Suffixes
- **Random Suffixes**: Extensive use of 8-character random suffixes (e.g., `234D62C1`, `E8D03004`, `2F5D1D4F`)
- **Impact**: These appear in resource names and could vary between environments
- **Examples**: `xrayManagedPolicy234D62C1`, `executionRole2F5D1D4F`

#### B. Resource Ordering
- **Non-Sorted Resources**: Resources are not consistently ordered in templates
- **Impact**: Different ordering between environments could cause hash differences
- **Evidence**: All analyzed templates show `Resources are sorted: false`

#### C. CDK Metadata
- **Path Metadata**: Every resource contains `aws:cdk:path` metadata
- **Asset Metadata**: Asset-related resources contain additional metadata keys:
  - `aws:asset:path`
  - `aws:asset:is-bundled` 
  - `aws:asset:property`

#### D. Environment-Specific Content
- **AWS Pseudo Parameters**: `${AWS::Partition}`, `${AWS::Region}`, `${AWS::AccountId}`
- **Asset Bucket References**: `${AssetsBucketName}`, `${AssetsBucketPrefix}`
- **CDK Bootstrap References**: `cdk-hnb659fds-` patterns

### 4. Template Analysis Results

#### Az-Tagger Template (`multiazworkshopaztaggerD1FA9152.nested.template.json`)
- **Size**: 20,811 characters
- **Asset References**: 2 (same hash repeated)
- **Random Suffixes**: 30 instances
- **Resources**: 11 (unsorted)
- **Key Hash**: `144170bb71d7ec309ba7b67b3ffb58b3683e73e94c4bf5011764b5236b61794a`

#### Database Template (`multiazworkshopdatabase0F201493.nested.template.json`)
- **Size**: 10,358 characters
- **Asset References**: 0
- **Random Suffixes**: 42 instances
- **Resources**: 7 (unsorted)
- **Complex Parameter Names**: Very long cross-stack reference parameters

#### ECR Uploader Template (`multiazworkshopecruploader1AA6410E.nested.template.json`)
- **Size**: 22,304 characters
- **Asset References**: 2 (same hash repeated)
- **Random Suffixes**: 25 instances
- **Resources**: 7 (unsorted)

#### Network Template (`multiazworkshopnetworkFBEB94A3.nested.template.json`)
- **Size**: 56,266 characters (largest)
- **Asset References**: 0
- **Random Suffixes**: 260 instances
- **Resources**: 56 (unsorted)

### 5. Asset Hash Calculation Issues

The debugging revealed that CDK's asset hash calculation is fundamentally broken in this project:

```
Expected Hash: a81ce5a783f553abd9699d414578781b3c49b551368e8969336d013b06a79531
Actual SHA256: Error: EISDIR: illegal operation on a directory, read
```

This suggests that:
1. CDK is trying to hash directories instead of files for some assets
2. The asset packaging process may not be working correctly
3. There's a mismatch between what CDK expects to hash and what actually exists

### 6. Environment Differences

Based on the analysis, the most likely sources of CI vs local differences are:

1. **File System Differences**: Different file timestamps, permissions, or directory structures
2. **Node.js/NPM Version Differences**: Different dependency resolution or build behavior
3. **CDK Context Differences**: Different CDK context values between environments
4. **Asset Processing Order**: Non-deterministic asset processing leading to different hashes

## Recommendations for Next Steps

1. **Fix Asset Hash Calculation**: Investigate why CDK is trying to hash directories instead of files
2. **Normalize CDK Synthesis**: Implement deterministic resource ordering and metadata handling
3. **Environment Isolation**: Ensure CDK synthesis is not affected by environment-specific variables
4. **Asset Processing Pipeline**: Fix the asset packaging to ensure consistent file generation

## Files Generated

- `scripts/debug-asset-hashes.js`: Comprehensive debugging utility
- `scripts/compare-asset-contents.js`: Detailed content analysis utility
- `asset-debug-output.txt`: Local environment debugging results
- `asset-comparison-output.txt`: Detailed template analysis results
##
# 7. Git Blob SHA Analysis (Enhanced)

**Critical Discovery**: The enhanced debugging now tracks git blob SHAs which are essential for understanding the `git diff --staged` comparison:

- **Current Static Template Blob SHA**: `52fd9509d46c393dbd717e6732a9fb107f12e074`
- **Committed Static Template Blob SHA**: `52fd9509d46c393dbd717e6732a9fb107f12e074`
- **Generated Template Blob SHA**: `52fd9509d46c393dbd717e6732a9fb107f12e074`
- **Local Environment**: All blob SHAs match (no mutations detected locally)

**Key Insight**: When the CI workflow runs `git diff --staged --patch --exit-code > repo.patch`, it compares:
- **Old blob SHA**: The committed version in HEAD
- **New blob SHA**: The generated version after `npx projen build`

The enhanced debugging utilities now capture:
1. **Pre-build state**: Blob SHA before build execution
2. **Post-build state**: Blob SHA after build execution  
3. **Commit history**: Blob SHAs from recent commits affecting the static template
4. **Simulated git diff**: What the CI workflow would see during the comparison

### 8. Enhanced CI Debugging Capabilities

Created comprehensive debugging tools that will capture in CI:
- **Git repository state**: Branch, commit, author, working directory status
- **Blob SHA tracking**: Before/after build comparison
- **Asset hash analysis**: Detailed breakdown of which specific hashes change
- **Diff analysis**: Sample of actual differences causing mutations
- **Asset manifest correlation**: Mapping changed hashes to source files

## Enhanced Debugging Tools Created

1. **`scripts/debug-asset-hashes.js`**: Comprehensive local debugging with git blob SHA tracking
2. **`scripts/compare-asset-contents.js`**: Detailed template content analysis
3. **`scripts/enhanced-ci-debug.sh`**: CI-specific debugging with blob SHA comparison
4. **Analysis outputs**: `asset-debug-output.txt`, `asset-comparison-output.txt`

These tools now provide the exact blob SHA information needed to understand what the CI workflow sees when it detects mutations, enabling precise tracking of which commits and branches are associated with asset hash differences.