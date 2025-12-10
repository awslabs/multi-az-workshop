#!/usr/bin/env node

/**
 * Compare az-tagger nested stack template between old commit and current version
 */

const fs = require('fs');
const { execSync } = require('child_process');

class AzTaggerComparator {
  constructor(oldBlobSha) {
    this.oldBlobSha = oldBlobSha;
    this.outputFile = 'aztagger-comparison.txt';
    this.currentAzTaggerFile = 'cdk.out/multiazworkshopaztaggerD1FA9152.nested.template.json';
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    fs.appendFileSync(this.outputFile, logMessage + '\n');
  }

  /**
   * Find the commit that contains the old blob
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
   * Find the az-tagger nested template file in the old commit
   */
  findOldAzTaggerFile(oldCommit) {
    try {
      // List all nested template files in cdk.out from the old commit
      const cdkOutFiles = execSync(`git ls-tree -r --name-only ${oldCommit} | grep "cdk.out.*aztagger.*nested.template.json"`, { encoding: 'utf8' });
      const files = cdkOutFiles.trim().split('\n').filter(f => f);
      
      if (files.length > 0) {
        this.log(`Found old az-tagger file: ${files[0]}`);
        return files[0];
      }
      
      this.log('No az-tagger nested template found in old commit');
      return null;
    } catch (error) {
      this.log(`Error finding old az-tagger file: ${error.message}`);
      return null;
    }
  }

  /**
   * Get file content from old commit
   */
  getOldFileContent(oldCommit, filePath) {
    try {
      const content = execSync(`git show ${oldCommit}:${filePath}`, { encoding: 'utf8' });
      return content;
    } catch (error) {
      this.log(`Error reading old file ${filePath}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get current file content
   */
  getCurrentFileContent() {
    try {
      if (fs.existsSync(this.currentAzTaggerFile)) {
        return fs.readFileSync(this.currentAzTaggerFile, 'utf8');
      }
      return null;
    } catch (error) {
      this.log(`Error reading current file: ${error.message}`);
      return null;
    }
  }

  /**
   * Get current assets.json content
   */
  getCurrentAssetsJson() {
    try {
      const assetsFile = 'cdk.out/multi-az-workshop.assets.json';
      if (fs.existsSync(assetsFile)) {
        return fs.readFileSync(assetsFile, 'utf8');
      }
      return null;
    } catch (error) {
      this.log(`Error reading assets.json: ${error.message}`);
      return null;
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
    
    this.log('Az-Tagger Content Analysis for CI Debugging');
    this.log('===========================================');
    this.log('This script outputs the current local az-tagger content and assets.json');
    this.log('to compare against what the CI workflow generates.');
    
    // Get current content
    this.log('\n=== CURRENT LOCAL CONTENT ===');
    const currentContent = this.getCurrentFileContent();
    
    if (!currentContent) {
      this.log('Could not read current az-tagger content');
      return;
    }
    
    this.log(`Current file: ${this.currentAzTaggerFile}`);
    this.log(`Content length: ${currentContent.length} characters`);
    
    this.log('\n=== CURRENT AZ-TAGGER NESTED TEMPLATE CONTENT ===');
    this.log(currentContent);
    
    // Get current assets.json
    const assetsJson = this.getCurrentAssetsJson();
    if (assetsJson) {
      this.log('\n=== CURRENT ASSETS.JSON CONTENT ===');
      this.log(assetsJson);
    } else {
      this.log('\n=== ASSETS.JSON NOT FOUND ===');
    }
    
    // Show hash information
    try {
      const parsed = JSON.parse(currentContent);
      this.log('\n=== TEMPLATE ANALYSIS ===');
      
      if (parsed.Resources) {
        const resourceCount = Object.keys(parsed.Resources).length;
        this.log(`Resource count: ${resourceCount}`);
        
        const resourceTypes = [...new Set(Object.values(parsed.Resources).map(r => r.Type))];
        this.log(`Resource types: ${resourceTypes.join(', ')}`);
        
        // Show resource names
        const resourceNames = Object.keys(parsed.Resources);
        this.log(`Resource names: ${resourceNames.join(', ')}`);
      }
      
      if (parsed.Parameters) {
        const paramNames = Object.keys(parsed.Parameters);
        this.log(`Parameters: ${paramNames.join(', ')}`);
      }
      
    } catch (error) {
      this.log(`Error parsing template: ${error.message}`);
    }
    
    this.log(`\n=== ANALYSIS COMPLETE ===`);
    this.log(`This content represents the "expected" version (hash 7023...)`);
    this.log(`The CI workflow is generating a different version that needs to be compared.`);
    this.log(`Full output saved to: ${this.outputFile}`);
  }
}

// Run the comparison
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error('Usage: compare-aztagger-content.js <old-static-template-blob-sha>');
    console.error('Example: compare-aztagger-content.js 52fd950');
    process.exit(1);
  }
  
  const oldBlobSha = args[0];
  
  const comparator = new AzTaggerComparator(oldBlobSha);
  comparator.compare().catch(error => {
    console.error('Comparison failed:', error);
    process.exit(1);
  });
}

module.exports = AzTaggerComparator;