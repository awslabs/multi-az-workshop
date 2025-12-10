#!/usr/bin/env node

/**
 * Compare CDK asset content between two blob versions of static/multi-az-workshop.json
 */

const fs = require('fs');
const { execSync } = require('child_process');

class BlobAssetComparator {
  constructor(oldBlobSha, newBlobSha) {
    this.oldBlobSha = oldBlobSha;
    this.newBlobSha = newBlobSha;
    this.outputFile = 'blob-asset-comparison.txt';
    this.assetManifestFile = 'cdk.out/multi-az-workshop.assets.json';
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    fs.appendFileSync(this.outputFile, logMessage + '\n');
  }

  /**
   * Get content from a git blob
   */
  getBlobContent(blobSha) {
    try {
      const content = execSync(`git cat-file blob ${blobSha}`, { encoding: 'utf8' });
      return content;
    } catch (error) {
      this.log(`Error reading blob ${blobSha}: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract asset hashes from template content
   */
  extractAssetHashes(templateContent) {
    const hashes = [];
    const hashRegex = /([a-f0-9]{64})\.json/g;
    let match;
    
    while ((match = hashRegex.exec(templateContent)) !== null) {
      hashes.push(match[1]);
    }
    
    return [...new Set(hashes)]; // Remove duplicates
  }

  /**
   * Get asset info from current manifest
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
      this.log(`Error reading current asset file ${sourcePath}: ${error.message}`);
      return null;
    }
  }

  /**
   * Find the old version of an asset file by matching the source path pattern
   */
  findOldAssetFile(sourcePath, oldCommit) {
    try {
      // Extract the base filename pattern (remove the hash prefix)
      const basePattern = sourcePath.replace(/^asset\.[a-f0-9]{64}\.?/, '');
      
      this.log(`Looking for old version of ${sourcePath} (pattern: ${basePattern}) in commit ${oldCommit}`);
      
      // List all files in cdk.out from the old commit
      const cdkOutFiles = execSync(`git ls-tree -r --name-only ${oldCommit} | grep "^cdk.out/"`, { encoding: 'utf8' }).split('\n').filter(f => f);
      
      this.log(`Found ${cdkOutFiles.length} files in cdk.out from old commit`);
      
      // Look for files that match the pattern
      for (const file of cdkOutFiles) {
        const fileName = file.replace('cdk.out/', '');
        const fileBasePattern = fileName.replace(/^asset\.[a-f0-9]{64}\.?/, '');
        
        if (fileBasePattern === basePattern) {
          this.log(`Found matching file: ${file}`);
          
          // Get the content of this file from the old commit
          const content = execSync(`git show ${oldCommit}:${file}`, { encoding: 'utf8' });
          return {
            path: file,
            content: content
          };
        }
      }
      
      this.log(`No matching file found for pattern: ${basePattern}`);
      return null;
    } catch (error) {
      this.log(`Error finding old asset file: ${error.message}`);
      return null;
    }
  }

  /**
   * Find the commit that contains a specific blob
   */
  findCommitForBlob(blobSha) {
    try {
      const result = execSync(`git log --all --format="%H" --find-object=${blobSha}`, { encoding: 'utf8' });
      const commits = result.trim().split('\n').filter(c => c);
      return commits.length > 0 ? commits[0] : null;
    } catch (error) {
      this.log(`Error finding commit for blob ${blobSha}: ${error.message}`);
      return null;
    }
  }

  /**
   * Compare two text contents and show differences
   */
  compareContents(content1, content2, label1, label2) {
    this.log(`\n=== COMPARING ${label1} vs ${label2} ===`);
    
    if (!content1 && !content2) {
      this.log('Both contents are null');
      return;
    }
    
    if (!content1) {
      this.log(`${label1} is null, ${label2} has ${content2.length} characters`);
      return;
    }
    
    if (!content2) {
      this.log(`${label2} is null, ${label1} has ${content1.length} characters`);
      return;
    }
    
    this.log(`${label1} length: ${content1.length} characters`);
    this.log(`${label2} length: ${content2.length} characters`);
    
    if (content1 === content2) {
      this.log('Contents are identical');
      return;
    }
    
    this.log('Contents are different');
    
    // Try to parse as JSON and show structured differences
    try {
      const json1 = JSON.parse(content1);
      const json2 = JSON.parse(content2);
      
      this.log('Both contents are valid JSON');
      this.compareJsonObjects(json1, json2, label1, label2);
      
    } catch (error) {
      this.log('Contents are not valid JSON, showing text differences');
      
      // Show line-by-line differences for first 20 lines
      const lines1 = content1.split('\n');
      const lines2 = content2.split('\n');
      
      const maxLines = Math.min(Math.max(lines1.length, lines2.length), 20);
      
      for (let i = 0; i < maxLines; i++) {
        const line1 = lines1[i] || '';
        const line2 = lines2[i] || '';
        
        if (line1 !== line2) {
          this.log(`Line ${i + 1} differs:`);
          this.log(`  ${label1}: ${line1.substring(0, 150)}${line1.length > 150 ? '...' : ''}`);
          this.log(`  ${label2}: ${line2.substring(0, 150)}${line2.length > 150 ? '...' : ''}`);
        }
      }
    }
  }

  /**
   * Compare JSON objects and show differences
   */
  compareJsonObjects(obj1, obj2, label1, label2, path = '') {
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
          this.compareJsonObjects(val1, val2, label1, label2, currentPath);
        }
      } else if (val1 !== val2) {
        const val1Str = String(val1).substring(0, 200);
        const val2Str = String(val2).substring(0, 200);
        this.log(`  ${currentPath}:`);
        this.log(`    ${label1}: ${val1Str}${String(val1).length > 200 ? '...' : ''}`);
        this.log(`    ${label2}: ${val2Str}${String(val2).length > 200 ? '...' : ''}`);
      }
    }
  }

  /**
   * Main comparison function
   */
  async compare() {
    // Clear previous output
    if (fs.existsSync(this.outputFile)) {
      fs.unlinkSync(this.outputFile);
    }
    
    this.log('CDK Asset Blob Comparison');
    this.log('=========================');
    this.log(`Old blob: ${this.oldBlobSha}`);
    this.log(`New blob: ${this.newBlobSha}`);
    
    // Get content from both blobs
    this.log('\n=== READING BLOB CONTENTS ===');
    const oldContent = this.getBlobContent(this.oldBlobSha);
    const newContent = this.getBlobContent(this.newBlobSha);
    
    if (!oldContent || !newContent) {
      this.log('Failed to read one or both blob contents');
      return;
    }
    
    this.log(`Old content length: ${oldContent.length} characters`);
    this.log(`New content length: ${newContent.length} characters`);
    
    // Extract asset hashes from both versions
    this.log('\n=== EXTRACTING ASSET HASHES ===');
    const oldHashes = this.extractAssetHashes(oldContent);
    const newHashes = this.extractAssetHashes(newContent);
    
    this.log(`Old template has ${oldHashes.length} unique asset hashes`);
    this.log(`New template has ${newHashes.length} unique asset hashes`);
    
    // Find differences
    const onlyInOld = oldHashes.filter(h => !newHashes.includes(h));
    const onlyInNew = newHashes.filter(h => !oldHashes.includes(h));
    const common = oldHashes.filter(h => newHashes.includes(h));
    
    this.log(`\nAsset hash differences:`);
    this.log(`  Only in old: ${onlyInOld.length} hashes`);
    this.log(`  Only in new: ${onlyInNew.length} hashes`);
    this.log(`  Common: ${common.length} hashes`);
    
    if (onlyInOld.length > 0) {
      this.log(`\nHashes only in old: ${onlyInOld.slice(0, 3).join(', ')}${onlyInOld.length > 3 ? '...' : ''}`);
    }
    
    if (onlyInNew.length > 0) {
      this.log(`\nHashes only in new: ${onlyInNew.slice(0, 3).join(', ')}${onlyInNew.length > 3 ? '...' : ''}`);
    }
    
    // Find the old commit for comparison
    const oldCommit = this.findCommitForBlob(this.oldBlobSha);
    if (!oldCommit) {
      this.log('Could not find commit for old blob');
      return;
    }
    
    this.log(`\nOld blob is from commit: ${oldCommit}`);
    
    // Compare the first differing asset
    if (onlyInNew.length > 0 && onlyInOld.length > 0) {
      this.log(`\n=== ANALYZING FIRST ASSET DIFFERENCE ===`);
      
      const newHash = onlyInNew[0];
      const oldHash = onlyInOld[0];
      
      this.log(`Comparing assets:`);
      this.log(`  Old hash: ${oldHash}`);
      this.log(`  New hash: ${newHash}`);
      
      // Get info about the new asset
      const newAssetInfo = this.getAssetInfo(newHash);
      if (newAssetInfo) {
        this.log(`\nNew asset info:`);
        this.log(`  Display Name: ${newAssetInfo.displayName}`);
        this.log(`  Source Path: ${newAssetInfo.source.path}`);
        this.log(`  Packaging: ${newAssetInfo.source.packaging}`);
        
        // Get current content
        const newAssetContent = this.getCurrentAssetContent(newAssetInfo.source.path);
        
        // Find the old version of this asset
        const oldAssetFile = this.findOldAssetFile(newAssetInfo.source.path, oldCommit);
        
        if (oldAssetFile) {
          this.log(`\nFound old version: ${oldAssetFile.path}`);
          
          // Compare the contents
          this.compareContents(
            oldAssetFile.content,
            newAssetContent,
            `Old (${oldHash})`,
            `New (${newHash})`
          );
        } else {
          this.log(`\nCould not find old version of asset file`);
          
          if (newAssetContent) {
            this.log(`\nNew asset content (${newAssetContent.length} chars):`);
            this.log('--- BEGIN NEW CONTENT ---');
            this.log(newAssetContent);
            this.log('--- END NEW CONTENT ---');
          }
        }
      } else {
        this.log(`Could not find asset info for new hash: ${newHash}`);
      }
    }
    
    this.log(`\n=== COMPARISON COMPLETE ===`);
    this.log(`Full output saved to: ${this.outputFile}`);
  }
}

// Run the comparison
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: compare-blob-assets.js <old-blob-sha> <new-blob-sha>');
    process.exit(1);
  }
  
  const oldBlobSha = args[0];
  const newBlobSha = args[1];
  
  const comparator = new BlobAssetComparator(oldBlobSha, newBlobSha);
  comparator.compare().catch(error => {
    console.error('Comparison failed:', error);
    process.exit(1);
  });
}

module.exports = BlobAssetComparator;