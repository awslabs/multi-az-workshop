#!/usr/bin/env node

/**
 * CDK Asset Diff Analysis Utility
 * 
 * This script analyzes git diff output to identify CDK asset hash mismatches,
 * traces them back to their source files, and compares content between commits.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class AssetDiffAnalyzer {
  constructor() {
    this.outputFile = 'asset-diff-analysis.txt';
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
   * Get git diff for the static template file
   */
  getStaticTemplateDiff() {
    try {
      // Get the diff for the static template
      const diff = execSync(`git diff HEAD ${this.staticTemplateFile}`, { encoding: 'utf8' });
      return diff;
    } catch (error) {
      this.log(`Error getting git diff: ${error.message}`);
      return '';
    }
  }

  /**
   * Extract asset hash changes from git diff output
   */
  extractAssetHashChanges(diffOutput) {
    const changes = [];
    const lines = diffOutput.split('\n');
    
    for (const line of lines) {
      // Look for lines that show asset hash changes (64-character hex strings)
      const assetHashRegex = /[\+\-].*([a-f0-9]{64})\.json/g;
      let match;
      
      while ((match = assetHashRegex.exec(line)) !== null) {
        const isAddition = line.startsWith('+');
        const isRemoval = line.startsWith('-');
        const hash = match[1];
        
        if (isAddition || isRemoval) {
          changes.push({
            type: isAddition ? 'added' : 'removed',
            hash: hash,
            line: line.trim()
          });
        }
      }
    }
    
    return changes;
  }

  /**
   * Get asset information from the manifest file
   */
  getAssetInfo(hash) {
    try {
      if (!fs.existsSync(this.assetManifestFile)) {
        return null;
      }
      
      const manifestContent = fs.readFileSync(this.assetManifestFile, 'utf8');
      const manifest = JSON.parse(manifestContent);
      
      if (manifest.files && manifest.files[hash]) {
        return manifest.files[hash];
      }
      
      return null;
    } catch (error) {
      this.log(`Error reading asset manifest: ${error.message}`);
      return null;
    }
  }

  /**
   * Get the content of an asset file from the current working directory
   */
  getCurrentAssetContent(sourcePath) {
    try {
      const fullPath = path.join('cdk.out', sourcePath);
      if (fs.existsSync(fullPath)) {
        return fs.readFileSync(fullPath, 'utf8');
      }
      return null;
    } catch (error) {
      this.log(`Error reading current asset file ${sourcePath}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get the content of an asset file from a specific commit
   * Since cdk.out/ is not committed, we need to reconstruct or find alternative approaches
   */
  getCommittedAssetContent(commit, sourcePath) {
    this.log(`Attempting to get committed content for ${sourcePath} from ${commit}`);
    
    // Since cdk.out/ is not committed to git, we can't directly access the committed version
    // We'll need to use alternative approaches:
    
    // 1. Try to get the file directly (this will likely fail)
    try {
      const fullPath = `cdk.out/${sourcePath}`;
      const content = execSync(`git show ${commit}:${fullPath}`, { encoding: 'utf8' });
      this.log(`Successfully read committed file directly: ${fullPath}`);
      return content;
    } catch (error) {
      this.log(`Cannot read committed cdk.out file directly (expected): ${error.message}`);
    }
    
    // 2. Since we can't get the committed version, we'll note this limitation
    this.log(`Note: cdk.out/ directory is not committed to git, so we cannot directly compare`);
    this.log(`with the committed version of the asset file.`);
    this.log(`The asset hash difference indicates the content has changed between builds.`);
    
    return null;
  }

  /**
   * Find the corresponding asset hash in the committed version
   */
  findCorrespondingCommittedHash(currentHash, commit = 'HEAD') {
    try {
      // Get the current asset info
      const currentAssetInfo = this.getAssetInfo(currentHash);
      if (!currentAssetInfo) {
        return null;
      }
      
      // Get the committed static template
      const committedTemplate = execSync(`git show ${commit}:${this.staticTemplateFile}`, { encoding: 'utf8' });
      const committedHashes = committedTemplate.match(/[a-f0-9]{64}/g) || [];
      
      this.log(`Found ${committedHashes.length} asset hashes in committed template`);
      
      // Since cdk.out/ is not committed, we can't read the committed manifest
      // Instead, we'll try to match based on the asset hashes in the template
      // and assume the first different hash corresponds to our current asset
      
      // For now, return the first committed hash that's different from current
      for (const hash of committedHashes) {
        if (hash !== currentHash) {
          this.log(`Found different committed hash: ${hash}`);
          return {
            hash: hash,
            assetInfo: {
              displayName: currentAssetInfo.displayName + ' (committed version)',
              source: {
                path: currentAssetInfo.source.path,
                packaging: currentAssetInfo.source.packaging
              }
            }
          };
        }
      }
      
      return null;
    } catch (error) {
      this.log(`Error finding corresponding committed hash: ${error.message}`);
      return null;
    }
  }

  /**
   * Check if two source paths are similar (same file, different hash)
   */
  isSimilarSourcePath(path1, path2) {
    // Remove hash prefixes and compare the rest
    const cleanPath1 = path1.replace(/^asset\.[a-f0-9]{64}\.?/, '');
    const cleanPath2 = path2.replace(/^asset\.[a-f0-9]{64}\.?/, '');
    
    return cleanPath1 === cleanPath2;
  }

  /**
   * Compare two asset contents and highlight differences
   */
  compareAssetContents(content1, content2, label1, label2) {
    this.log(`\n=== CONTENT COMPARISON: ${label1} vs ${label2} ===`);
    
    if (!content1 && !content2) {
      this.log('Both contents are null');
      return;
    }
    
    if (!content1) {
      this.log(`${label1} content is null`);
      this.log(`${label2} content length: ${content2.length} characters`);
      return;
    }
    
    if (!content2) {
      this.log(`${label2} content is null`);
      this.log(`${label1} content length: ${content1.length} characters`);
      return;
    }
    
    this.log(`${label1} content length: ${content1.length} characters`);
    this.log(`${label2} content length: ${content2.length} characters`);
    
    if (content1 === content2) {
      this.log('Contents are identical');
      return;
    }
    
    // Try to parse as JSON and compare
    try {
      const json1 = JSON.parse(content1);
      const json2 = JSON.parse(content2);
      
      this.log('Both contents are valid JSON');
      
      // Compare keys
      const keys1 = Object.keys(json1).sort();
      const keys2 = Object.keys(json2).sort();
      
      if (JSON.stringify(keys1) !== JSON.stringify(keys2)) {
        this.log(`Different top-level keys:`);
        this.log(`  ${label1}: ${keys1.join(', ')}`);
        this.log(`  ${label2}: ${keys2.join(', ')}`);
      } else {
        this.log('Same top-level keys');
      }
      
      // Look for specific differences
      this.findJsonDifferences(json1, json2, label1, label2);
      
    } catch (error) {
      this.log('Contents are not valid JSON, comparing as text');
      
      // Simple line-by-line comparison
      const lines1 = content1.split('\n');
      const lines2 = content2.split('\n');
      
      const maxLines = Math.max(lines1.length, lines2.length);
      let differences = 0;
      
      for (let i = 0; i < Math.min(maxLines, 10); i++) {
        const line1 = lines1[i] || '';
        const line2 = lines2[i] || '';
        
        if (line1 !== line2) {
          differences++;
          this.log(`Line ${i + 1} differs:`);
          this.log(`  ${label1}: ${line1.substring(0, 100)}${line1.length > 100 ? '...' : ''}`);
          this.log(`  ${label2}: ${line2.substring(0, 100)}${line2.length > 100 ? '...' : ''}`);
        }
      }
      
      if (differences === 0) {
        this.log('First 10 lines are identical');
      } else {
        this.log(`Found ${differences} different lines in first 10 lines`);
      }
    }
  }

  /**
   * Find specific differences in JSON objects
   */
  findJsonDifferences(obj1, obj2, label1, label2, path = '') {
    const keys = new Set([...Object.keys(obj1), ...Object.keys(obj2)]);
    
    for (const key of keys) {
      const currentPath = path ? `${path}.${key}` : key;
      const val1 = obj1[key];
      const val2 = obj2[key];
      
      if (val1 === undefined) {
        this.log(`  ${currentPath}: only in ${label2}`);
      } else if (val2 === undefined) {
        this.log(`  ${currentPath}: only in ${label1}`);
      } else if (typeof val1 !== typeof val2) {
        this.log(`  ${currentPath}: different types (${typeof val1} vs ${typeof val2})`);
      } else if (typeof val1 === 'object' && val1 !== null && val2 !== null) {
        // Recursively compare objects (but limit depth)
        if (path.split('.').length < 3) {
          this.findJsonDifferences(val1, val2, label1, label2, currentPath);
        }
      } else if (val1 !== val2) {
        // Show first difference found
        const val1Str = String(val1).substring(0, 100);
        const val2Str = String(val2).substring(0, 100);
        this.log(`  ${currentPath}: "${val1Str}" vs "${val2Str}"`);
      }
    }
  }

  /**
   * Main analysis function
   */
  async analyze() {
    // Clear previous output
    if (fs.existsSync(this.outputFile)) {
      fs.unlinkSync(this.outputFile);
    }
    
    this.log('CDK Asset Diff Analysis');
    this.log('=======================');
    
    // Get git diff for static template
    this.log('\n=== ANALYZING GIT DIFF ===');
    const diff = this.getStaticTemplateDiff();
    
    if (!diff) {
      this.log('No git diff found for static template');
      return;
    }
    
    this.log(`Git diff length: ${diff.length} characters`);
    
    // Extract asset hash changes
    const changes = this.extractAssetHashChanges(diff);
    this.log(`Found ${changes.length} asset hash changes`);
    
    if (changes.length === 0) {
      this.log('No asset hash changes found in diff');
      return;
    }
    
    // Analyze the first mismatch
    this.log('\n=== ANALYZING FIRST ASSET HASH MISMATCH ===');
    
    // Group changes by type
    const added = changes.filter(c => c.type === 'added');
    const removed = changes.filter(c => c.type === 'removed');
    
    this.log(`Added hashes: ${added.length}`);
    this.log(`Removed hashes: ${removed.length}`);
    
    if (added.length > 0 && removed.length > 0) {
      // Analyze the first pair
      const addedHash = added[0].hash;
      const removedHash = removed[0].hash;
      
      this.log(`\nAnalyzing hash change: ${removedHash} -> ${addedHash}`);
      
      // Get asset info for both hashes
      const addedAssetInfo = this.getAssetInfo(addedHash);
      const removedCorresponding = this.findCorrespondingCommittedHash(addedHash);
      
      if (addedAssetInfo) {
        this.log(`\nCurrent asset info (${addedHash}):`);
        this.log(`  Display Name: ${addedAssetInfo.displayName}`);
        this.log(`  Source Path: ${addedAssetInfo.source.path}`);
        this.log(`  Packaging: ${addedAssetInfo.source.packaging}`);
        
        // Get current content
        const currentContent = this.getCurrentAssetContent(addedAssetInfo.source.path);
        
        this.log(`\nCurrent asset content preview:`);
        if (currentContent) {
          this.log(`  Content length: ${currentContent.length} characters`);
          
          // Show first few lines of content
          const lines = currentContent.split('\n').slice(0, 5);
          this.log(`  First few lines:`);
          lines.forEach((line, index) => {
            this.log(`    ${index + 1}: ${line.substring(0, 100)}${line.length > 100 ? '...' : ''}`);
          });
          
          // Try to identify what type of content this is
          try {
            const parsed = JSON.parse(currentContent);
            this.log(`  Content type: JSON`);
            
            if (parsed.AWSTemplateFormatVersion) {
              this.log(`  CloudFormation template detected`);
              this.log(`  Template description: ${parsed.Description || 'N/A'}`);
              
              // Look for resources that might indicate what changed
              if (parsed.Resources) {
                const resourceCount = Object.keys(parsed.Resources).length;
                this.log(`  Resource count: ${resourceCount}`);
                
                const resourceTypes = [...new Set(Object.values(parsed.Resources).map(r => r.Type))];
                this.log(`  Resource types: ${resourceTypes.slice(0, 5).join(', ')}${resourceTypes.length > 5 ? '...' : ''}`);
              }
            }
          } catch (e) {
            this.log(`  Content type: Non-JSON or malformed JSON`);
          }
        } else {
          this.log(`  Could not read current content`);
        }
        
        // Since we can't easily get the committed version, focus on what we can determine
        this.log(`\nAsset hash analysis:`);
        this.log(`  Old hash (being removed): ${removedHash}`);
        this.log(`  New hash (being added): ${addedHash}`);
        this.log(`  This indicates the content of ${addedAssetInfo.source.path} has changed`);
        this.log(`  between the committed version and the current build.`)
      } else {
        this.log(`Could not find asset info for added hash: ${addedHash}`);
      }
    } else if (added.length > 0) {
      this.log('\nOnly added hashes found (no removals)');
      const hash = added[0].hash;
      const assetInfo = this.getAssetInfo(hash);
      
      if (assetInfo) {
        this.log(`Added asset: ${assetInfo.displayName}`);
        this.log(`Source path: ${assetInfo.source.path}`);
      }
    } else if (removed.length > 0) {
      this.log('\nOnly removed hashes found (no additions)');
      const hash = removed[0].hash;
      this.log(`Removed hash: ${hash}`);
    }
    
    this.log(`\n=== ANALYSIS COMPLETE ===`);
    this.log(`Full output saved to: ${this.outputFile}`);
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