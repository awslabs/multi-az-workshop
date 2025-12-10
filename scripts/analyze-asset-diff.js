#!/usr/bin/env node

/**
 * CDK Asset Diff Analysis Utility
 * 
 * Analyzes git diff output to find CDK asset hash mismatches by:
 * 1. Getting blob SHAs from git diff
 * 2. Finding branch/commit info for each blob
 * 3. Identifying first CDK asset hash difference
 * 4. Recording content from both old and new versions
 */

const fs = require('fs');
const { execSync } = require('child_process');

class AssetDiffAnalyzer {
  constructor() {
    this.outputFile = 'debug-output.txt';
    this.staticTemplateFile = 'static/multi-az-workshop.json';
    this.assetManifestFile = 'cdk.out/multi-az-workshop.assets.json';
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    fs.appendFileSync(this.outputFile, logMessage + '\n');
  }

  /**
   * Get git diff with blob SHA information
   */
  getGitDiffWithBlobs() {
    try {
      // Get staged diff (what the CI sees)
      const diff = execSync('git diff --staged', { encoding: 'utf8' });
      return diff;
    } catch (error) {
      this.log(`Error getting git diff: ${error.message}`);
      return '';
    }
  }

  /**
   * Extract blob SHAs from git diff output
   */
  extractBlobSHAs(diffOutput) {
    const blobs = [];
    const lines = diffOutput.split('\n');
    
    let currentFile = null;
    for (const line of lines) {
      // Look for diff header with file path
      if (line.startsWith('diff --git')) {
        const match = line.match(/diff --git a\/(.+) b\/(.+)/);
        if (match) {
          currentFile = match[1]; // Use the 'a/' path
        }
      }
      
      // Look for index line with blob SHAs
      if (line.startsWith('index ') && currentFile) {
        const match = line.match(/index ([a-f0-9]+)\.\.([a-f0-9]+)/);
        if (match) {
          blobs.push({
            file: currentFile,
            oldBlob: match[1],
            newBlob: match[2]
          });
        }
      }
    }
    
    return blobs;
  }

  /**
   * Find commit information for a blob SHA
   */
  findCommitForBlob(blobSHA) {
    try {
      // Find which commit contains this blob
      const result = execSync(`git log --all --pretty=format:"%H %s" --find-object=${blobSHA}`, { encoding: 'utf8' });
      const lines = result.trim().split('\n').filter(line => line.length > 0);
      
      if (lines.length > 0) {
        const firstLine = lines[0];
        const [commitSHA, ...messageParts] = firstLine.split(' ');
        return {
          commit: commitSHA,
          message: messageParts.join(' '),
          allCommits: lines
        };
      }
      
      return null;
    } catch (error) {
      this.log(`Error finding commit for blob ${blobSHA}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get file content from a specific blob SHA
   */
  getContentFromBlob(blobSHA) {
    try {
      const content = execSync(`git cat-file -p ${blobSHA}`, { encoding: 'utf8' });
      return content;
    } catch (error) {
      this.log(`Error getting content from blob ${blobSHA}: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract CDK asset hash changes from file content
   */
  findAssetHashDifferences(oldContent, newContent) {
    const oldHashes = (oldContent.match(/[a-f0-9]{64}/g) || []);
    const newHashes = (newContent.match(/[a-f0-9]{64}/g) || []);
    
    const oldHashSet = new Set(oldHashes);
    const newHashSet = new Set(newHashes);
    
    const removed = oldHashes.filter(h => !newHashSet.has(h));
    const added = newHashes.filter(h => !oldHashSet.has(h));
    
    return { removed, added };
  }

  /**
   * Get asset information from manifest
   */
  getAssetInfo(hash) {
    try {
      if (!fs.existsSync(this.assetManifestFile)) {
        return null;
      }
      
      const manifestContent = fs.readFileSync(this.assetManifestFile, 'utf8');
      const manifest = JSON.parse(manifestContent);
      
      return manifest.files && manifest.files[hash] ? manifest.files[hash] : null;
    } catch (error) {
      this.log(`Error reading asset manifest: ${error.message}`);
      return null;
    }
  }

  /**
   * Get current asset file content
   */
  getCurrentAssetContent(sourcePath) {
    try {
      const fullPath = `cdk.out/${sourcePath}`;
      if (fs.existsSync(fullPath)) {
        return fs.readFileSync(fullPath, 'utf8');
      }
      return null;
    } catch (error) {
      this.log(`Error reading asset file ${sourcePath}: ${error.message}`);
      return null;
    }
  }

  /**
   * Main analysis function
   */
  async analyze() {
    // Clear previous output and start fresh
    if (fs.existsSync(this.outputFile)) {
      fs.unlinkSync(this.outputFile);
    }
    
    this.log('=== CDK ASSET DIFF ANALYSIS ===');
    
    // Step 1: Get git diff with blob information
    this.log('\n=== STEP 1: ANALYZING GIT DIFF ===');
    const diff = this.getGitDiffWithBlobs();
    
    if (!diff) {
      this.log('No git diff found');
      return;
    }
    
    this.log(`Git diff length: ${diff.length} characters`);
    
    // Step 2: Extract blob SHAs
    this.log('\n=== STEP 2: EXTRACTING BLOB SHAS ===');
    const blobs = this.extractBlobSHAs(diff);
    this.log(`Found ${blobs.length} files with blob changes`);
    
    for (const blob of blobs) {
      this.log(`File: ${blob.file}`);
      this.log(`  Old blob: ${blob.oldBlob}`);
      this.log(`  New blob: ${blob.newBlob}`);
    }
    
    // Step 3: Find the static template file
    const staticTemplateBlob = blobs.find(b => b.file === this.staticTemplateFile);
    if (!staticTemplateBlob) {
      this.log(`\nStatic template file ${this.staticTemplateFile} not found in diff`);
      return;
    }
    
    this.log(`\n=== STEP 3: ANALYZING STATIC TEMPLATE CHANGES ===`);
    this.log(`Static template old blob: ${staticTemplateBlob.oldBlob}`);
    this.log(`Static template new blob: ${staticTemplateBlob.newBlob}`);
    
    // Step 4: Find commit information for each blob
    this.log('\n=== STEP 4: FINDING COMMIT INFORMATION ===');
    
    const oldCommitInfo = this.findCommitForBlob(staticTemplateBlob.oldBlob);
    const newCommitInfo = this.findCommitForBlob(staticTemplateBlob.newBlob);
    
    if (oldCommitInfo) {
      this.log(`Old blob commit: ${oldCommitInfo.commit}`);
      this.log(`Old blob message: ${oldCommitInfo.message}`);
    } else {
      this.log('Could not find commit for old blob');
    }
    
    if (newCommitInfo) {
      this.log(`New blob commit: ${newCommitInfo.commit}`);
      this.log(`New blob message: ${newCommitInfo.message}`);
    } else {
      this.log('Could not find commit for new blob');
    }
    
    // Step 5: Get file content from both blobs
    this.log('\n=== STEP 5: GETTING FILE CONTENT FROM BLOBS ===');
    
    const oldContent = this.getContentFromBlob(staticTemplateBlob.oldBlob);
    const newContent = this.getContentFromBlob(staticTemplateBlob.newBlob);
    
    if (!oldContent || !newContent) {
      this.log('Could not retrieve content from one or both blobs');
      return;
    }
    
    this.log(`Old content length: ${oldContent.length} characters`);
    this.log(`New content length: ${newContent.length} characters`);
    
    // Step 6: Find CDK asset hash differences
    this.log('\n=== STEP 6: FINDING CDK ASSET HASH DIFFERENCES ===');
    
    const hashDiffs = this.findAssetHashDifferences(oldContent, newContent);
    this.log(`Removed hashes: ${hashDiffs.removed.length}`);
    this.log(`Added hashes: ${hashDiffs.added.length}`);
    
    if (hashDiffs.removed.length > 0) {
      this.log('Removed hashes:');
      hashDiffs.removed.forEach(hash => this.log(`  - ${hash}`));
    }
    
    if (hashDiffs.added.length > 0) {
      this.log('Added hashes:');
      hashDiffs.added.forEach(hash => this.log(`  + ${hash}`));
    }
    
    // Step 7: Analyze the first asset hash difference
    if (hashDiffs.added.length > 0) {
      this.log('\n=== STEP 7: ANALYZING FIRST ASSET HASH DIFFERENCE ===');
      
      const firstNewHash = hashDiffs.added[0];
      this.log(`Analyzing new hash: ${firstNewHash}`);
      
      // Get asset info from manifest
      const assetInfo = this.getAssetInfo(firstNewHash);
      if (assetInfo) {
        this.log(`Asset display name: ${assetInfo.displayName}`);
        this.log(`Asset source path: ${assetInfo.source.path}`);
        this.log(`Asset packaging: ${assetInfo.source.packaging}`);
        
        // Get the current asset file content
        const assetContent = this.getCurrentAssetContent(assetInfo.source.path);
        if (assetContent) {
          this.log(`\n=== CURRENT ASSET FILE CONTENT ===`);
          this.log(`File: cdk.out/${assetInfo.source.path}`);
          this.log(`Content length: ${assetContent.length} characters`);
          this.log(`--- BEGIN CURRENT FILE CONTENT ---`);
          this.log(assetContent);
          this.log(`--- END CURRENT FILE CONTENT ---`);
        } else {
          this.log(`Could not read current asset file: cdk.out/${assetInfo.source.path}`);
        }
        
        // Try to find the old version of this asset
        if (hashDiffs.removed.length > 0) {
          const firstOldHash = hashDiffs.removed[0];
          this.log(`\n=== ATTEMPTING TO GET OLD ASSET CONTENT ===`);
          this.log(`Old hash: ${firstOldHash}`);
          
          // Since we can't easily get the old asset manifest, we'll try to reconstruct
          // the old asset file path and get it from the old commit
          if (oldCommitInfo) {
            this.log(`Attempting to get old asset content from commit ${oldCommitInfo.commit}`);
            
            // Try to get the old asset file by checking out the old commit temporarily
            try {
              // First, let's see what files existed in the old commit's cdk.out
              const oldCdkFiles = execSync(`git ls-tree -r --name-only ${oldCommitInfo.commit} | grep "cdk.out/"`, { encoding: 'utf8' });
              this.log(`Files in old commit cdk.out:`);
              this.log(oldCdkFiles);
              
              // Look for a file that might correspond to our asset
              const oldCdkFilesList = oldCdkFiles.trim().split('\n').filter(f => f.length > 0);
              const possibleOldFile = oldCdkFilesList.find(f => 
                f.includes('nested.template.json') && 
                f.includes(assetInfo.displayName.toLowerCase().replace(/[^a-z0-9]/g, ''))
              );
              
              if (possibleOldFile) {
                this.log(`Found possible old file: ${possibleOldFile}`);
                const oldAssetContent = execSync(`git show ${oldCommitInfo.commit}:${possibleOldFile}`, { encoding: 'utf8' });
                
                this.log(`\n=== OLD ASSET FILE CONTENT ===`);
                this.log(`File: ${possibleOldFile} (from commit ${oldCommitInfo.commit})`);
                this.log(`Content length: ${oldAssetContent.length} characters`);
                this.log(`--- BEGIN OLD FILE CONTENT ---`);
                this.log(oldAssetContent);
                this.log(`--- END OLD FILE CONTENT ---`);
                
                // Compare the two contents
                this.log(`\n=== CONTENT COMPARISON ===`);
                if (assetContent === oldAssetContent) {
                  this.log(`Contents are identical - this should not happen!`);
                } else {
                  this.log(`Contents differ - this explains the hash change`);
                  this.log(`Old content length: ${oldAssetContent.length}`);
                  this.log(`New content length: ${assetContent.length}`);
                  this.log(`Length difference: ${assetContent.length - oldAssetContent.length}`);
                }
              } else {
                this.log(`Could not find corresponding old asset file`);
              }
              
            } catch (error) {
              this.log(`Error getting old asset content: ${error.message}`);
            }
          }
        }
        
      } else {
        this.log(`Could not find asset info for hash: ${firstNewHash}`);
      }
    }
    
    this.log('\n=== ANALYSIS COMPLETE ===');
  }
}

// Run the analyzer
if (require.main === module) {
  const analyzer = new AssetDiffAnalyzer();
  analyzer.analyze().catch(error => {
    console.error('Analysis failed:', error);
    process.exit(1);
  });
}

module.exports = AssetDiffAnalyzer;