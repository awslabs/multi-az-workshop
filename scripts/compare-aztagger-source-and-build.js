#!/usr/bin/env node

/**
 * Compare az-tagger source files and if needed, build old commit to compare generated templates
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class AzTaggerSourceAndBuildComparator {
  constructor(oldBlobSha) {
    this.oldBlobSha = oldBlobSha;
    this.outputFile = 'aztagger-source-build-comparison.txt';
    this.tempDir = 'temp-old-commit';
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
   * Find az-tagger source files in the repository
   */
  findAzTaggerSourceFiles() {
    try {
      // Look for az-tagger related source files
      const sourceFiles = execSync(`find src -name "*aztagger*" -o -name "*az-tagger*" -type f`, { encoding: 'utf8' });
      return sourceFiles.trim().split('\n').filter(f => f);
    } catch (error) {
      this.log(`Error finding az-tagger source files: ${error.message}`);
      return [];
    }
  }

  /**
   * Compare source files between old commit and current
   */
  compareSourceFiles(oldCommit, sourceFiles) {
    let hasChanges = false;
    
    this.log('\n=== COMPARING SOURCE FILES ===');
    
    for (const sourceFile of sourceFiles) {
      this.log(`\nChecking: ${sourceFile}`);
      
      try {
        // Get old version
        const oldContent = execSync(`git show ${oldCommit}:${sourceFile}`, { encoding: 'utf8' });
        
        // Get current version
        const currentContent = fs.readFileSync(sourceFile, 'utf8');
        
        if (oldContent === currentContent) {
          this.log(`  ✓ No changes in ${sourceFile}`);
        } else {
          this.log(`  ✗ Changes detected in ${sourceFile}`);
          this.log(`    Old length: ${oldContent.length} chars`);
          this.log(`    Current length: ${currentContent.length} chars`);
          hasChanges = true;
          
          // Show first few lines of difference
          const oldLines = oldContent.split('\n').slice(0, 10);
          const currentLines = currentContent.split('\n').slice(0, 10);
          
          this.log(`    First 10 lines comparison:`);
          for (let i = 0; i < Math.max(oldLines.length, currentLines.length); i++) {
            const oldLine = oldLines[i] || '';
            const currentLine = currentLines[i] || '';
            
            if (oldLine !== currentLine) {
              this.log(`      Line ${i + 1}:`);
              this.log(`        Old: ${oldLine.substring(0, 100)}`);
              this.log(`        New: ${currentLine.substring(0, 100)}`);
            }
          }
        }
      } catch (error) {
        this.log(`  Error comparing ${sourceFile}: ${error.message}`);
      }
    }
    
    return hasChanges;
  }

  /**
   * Checkout old commit in temporary directory and build
   */
  buildOldCommit(oldCommit) {
    this.log('\n=== BUILDING OLD COMMIT ===');
    
    try {
      // Clean up any existing temp directory
      if (fs.existsSync(this.tempDir)) {
        execSync(`rm -rf ${this.tempDir}`, { stdio: 'inherit' });
      }
      
      // Clone current repo to temp directory
      this.log('Cloning repository to temporary directory...');
      execSync(`git clone . ${this.tempDir}`, { stdio: 'inherit' });
      
      // Checkout old commit
      this.log(`Checking out commit ${oldCommit}...`);
      execSync(`git checkout ${oldCommit}`, { cwd: this.tempDir, stdio: 'inherit' });
      
      // Install dependencies
      this.log('Installing dependencies...');
      execSync('yarn install --frozen-lockfile', { cwd: this.tempDir, stdio: 'inherit' });
      
      // Run build
      this.log('Running npx projen build...');
      execSync('npx projen build', { cwd: this.tempDir, stdio: 'inherit' });
      
      this.log('Build completed successfully');
      return true;
      
    } catch (error) {
      this.log(`Error building old commit: ${error.message}`);
      return false;
    }
  }

  /**
   * Compare generated az-tagger templates
   */
  compareGeneratedTemplates() {
    this.log('\n=== COMPARING GENERATED TEMPLATES ===');
    
    try {
      // Find az-tagger template in old build
      const oldCdkOut = path.join(this.tempDir, 'cdk.out');
      const oldFiles = fs.readdirSync(oldCdkOut).filter(f => f.includes('aztagger') && f.endsWith('.nested.template.json'));
      
      if (oldFiles.length === 0) {
        this.log('No az-tagger template found in old build');
        return;
      }
      
      const oldTemplateFile = path.join(oldCdkOut, oldFiles[0]);
      this.log(`Old template: ${oldTemplateFile}`);
      this.log(`Current template: ${this.currentAzTaggerFile}`);
      
      // Read both files
      const oldContent = fs.readFileSync(oldTemplateFile, 'utf8');
      const currentContent = fs.readFileSync(this.currentAzTaggerFile, 'utf8');
      
      this.log(`Old template length: ${oldContent.length} characters`);
      this.log(`Current template length: ${currentContent.length} characters`);
      
      if (oldContent === currentContent) {
        this.log('\n✓ Generated templates are identical');
        return;
      }
      
      this.log('\n✗ Generated templates are different');
      
      // Try to parse as JSON and compare
      try {
        const oldJson = JSON.parse(oldContent);
        const newJson = JSON.parse(currentContent);
        
        this.log('\nAnalyzing JSON differences...');
        this.compareJsonStructure(oldJson, newJson);
        
      } catch (parseError) {
        this.log('Could not parse as JSON, showing raw content differences');
      }
      
      // Show full content
      this.log('\n=== OLD GENERATED TEMPLATE ===');
      this.log(oldContent);
      
      this.log('\n=== CURRENT GENERATED TEMPLATE ===');
      this.log(currentContent);
      
    } catch (error) {
      this.log(`Error comparing generated templates: ${error.message}`);
    }
  }

  /**
   * Compare JSON structure and highlight differences
   */
  compareJsonStructure(oldJson, newJson, path = '') {
    const keys = new Set([...Object.keys(oldJson || {}), ...Object.keys(newJson || {})]);
    
    for (const key of keys) {
      const currentPath = path ? `${path}.${key}` : key;
      const oldVal = oldJson ? oldJson[key] : undefined;
      const newVal = newJson ? newJson[key] : undefined;
      
      if (oldVal === undefined) {
        this.log(`  + ${currentPath}: added`);
      } else if (newVal === undefined) {
        this.log(`  - ${currentPath}: removed`);
      } else if (typeof oldVal !== typeof newVal) {
        this.log(`  ~ ${currentPath}: type changed (${typeof oldVal} -> ${typeof newVal})`);
      } else if (typeof oldVal === 'object' && oldVal !== null && newVal !== null) {
        // Recursively compare objects (limit depth)
        if (path.split('.').length < 4) {
          this.compareJsonStructure(oldVal, newVal, currentPath);
        }
      } else if (oldVal !== newVal) {
        this.log(`  ~ ${currentPath}: value changed`);
        if (typeof oldVal === 'string' && typeof newVal === 'string') {
          if (oldVal.length < 200 && newVal.length < 200) {
            this.log(`    Old: ${oldVal}`);
            this.log(`    New: ${newVal}`);
          } else {
            this.log(`    Old: ${oldVal.substring(0, 100)}...`);
            this.log(`    New: ${newVal.substring(0, 100)}...`);
          }
        }
      }
    }
  }

  /**
   * Cleanup temporary directory
   */
  cleanup() {
    try {
      if (fs.existsSync(this.tempDir)) {
        execSync(`rm -rf ${this.tempDir}`);
        this.log('Cleaned up temporary directory');
      }
    } catch (error) {
      this.log(`Error cleaning up: ${error.message}`);
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
    
    this.log('Az-Tagger Source and Build Comparison');
    this.log('====================================');
    this.log(`Old static template blob: ${this.oldBlobSha}`);
    
    try {
      // Find the commit for the old blob
      const oldCommit = this.findCommitForBlob(this.oldBlobSha);
      if (!oldCommit) {
        this.log('Could not find commit for old blob');
        return;
      }
      
      this.log(`Old commit: ${oldCommit}`);
      
      // Find az-tagger source files
      const sourceFiles = this.findAzTaggerSourceFiles();
      this.log(`Found ${sourceFiles.length} az-tagger source files: ${sourceFiles.join(', ')}`);
      
      if (sourceFiles.length === 0) {
        this.log('No az-tagger source files found, proceeding to build comparison');
      } else {
        // Compare source files first
        const hasSourceChanges = this.compareSourceFiles(oldCommit, sourceFiles);
        
        if (hasSourceChanges) {
          this.log('\n=== CONCLUSION ===');
          this.log('Source file changes detected - this explains the asset hash differences');
          return;
        } else {
          this.log('\n=== SOURCE FILES IDENTICAL ===');
          this.log('No changes in source files, need to build old commit to compare generated output');
        }
      }
      
      // Build old commit and compare generated templates
      const buildSuccess = this.buildOldCommit(oldCommit);
      if (buildSuccess) {
        this.compareGeneratedTemplates();
      }
      
    } finally {
      // Always cleanup
      this.cleanup();
    }
    
    this.log(`\n=== COMPARISON COMPLETE ===`);
    this.log(`Full output saved to: ${this.outputFile}`);
  }
}

// Run the comparison
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error('Usage: compare-aztagger-source-and-build.js <old-static-template-blob-sha>');
    console.error('Example: compare-aztagger-source-and-build.js 52fd950');
    process.exit(1);
  }
  
  const oldBlobSha = args[0];
  
  const comparator = new AzTaggerSourceAndBuildComparator(oldBlobSha);
  comparator.compare().catch(error => {
    console.error('Comparison failed:', error);
    process.exit(1);
  });
}

module.exports = AzTaggerSourceAndBuildComparator;