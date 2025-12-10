#!/usr/bin/env node

/**
 * CDK Asset Hash Debugging Utility
 * 
 * This script collects detailed information about CDK asset hashes to help
 * identify differences between local and CI environments.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

class AssetHashDebugger {
  constructor() {
    this.outputFile = 'asset-debug-output.txt';
    this.cdkOutDir = 'cdk.out';
    this.staticTemplateFile = 'static/multi-az-workshop.json';
    this.assetManifestFile = path.join(this.cdkOutDir, 'multi-az-workshop.assets.json');
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    fs.appendFileSync(this.outputFile, logMessage + '\n');
  }

  async collectEnvironmentInfo() {
    this.log('=== ENVIRONMENT INFORMATION ===');
    
    // Node.js version
    this.log(`Node.js version: ${process.version}`);
    
    // NPM version
    try {
      const npmVersion = execSync('npm --version', { encoding: 'utf8' }).trim();
      this.log(`NPM version: ${npmVersion}`);
    } catch (error) {
      this.log(`NPM version: Error - ${error.message}`);
    }

    // CDK version
    try {
      const cdkVersion = execSync('npx cdk --version', { encoding: 'utf8' }).trim();
      this.log(`CDK version: ${cdkVersion}`);
    } catch (error) {
      this.log(`CDK version: Error - ${error.message}`);
    }

    // Operating system
    this.log(`Platform: ${process.platform}`);
    this.log(`Architecture: ${process.arch}`);
    
    // Working directory
    this.log(`Working directory: ${process.cwd()}`);
    
    // Environment variables that might affect CDK
    const relevantEnvVars = [
      'CI', 'NODE_ENV', 'CDK_DEFAULT_ACCOUNT', 'CDK_DEFAULT_REGION',
      'AWS_REGION', 'AWS_DEFAULT_REGION', 'GITHUB_ACTIONS', 'RUNNER_OS'
    ];
    
    this.log('Relevant environment variables:');
    relevantEnvVars.forEach(envVar => {
      const value = process.env[envVar] || 'undefined';
      this.log(`  ${envVar}: ${value}`);
    });
  }

  async collectGitInformation() {
    this.log('\n=== GIT REPOSITORY INFORMATION ===');
    
    try {
      // Current branch
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
      this.log(`Current branch: ${currentBranch}`);
      
      // Current commit
      const currentCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
      this.log(`Current commit: ${currentCommit}`);
      
      // Short commit hash
      const shortCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
      this.log(`Short commit: ${shortCommit}`);
      
      // Commit message
      const commitMessage = execSync('git log -1 --pretty=%B', { encoding: 'utf8' }).trim();
      this.log(`Commit message: ${commitMessage}`);
      
      // Author and date
      const commitAuthor = execSync('git log -1 --pretty=%an', { encoding: 'utf8' }).trim();
      const commitDate = execSync('git log -1 --pretty=%ci', { encoding: 'utf8' }).trim();
      this.log(`Commit author: ${commitAuthor}`);
      this.log(`Commit date: ${commitDate}`);
      
      // Check if working directory is clean
      try {
        execSync('git diff --quiet', { encoding: 'utf8' });
        execSync('git diff --cached --quiet', { encoding: 'utf8' });
        this.log('Working directory: clean');
      } catch (error) {
        this.log('Working directory: has uncommitted changes');
        
        // Show what files are modified
        try {
          const modifiedFiles = execSync('git diff --name-only', { encoding: 'utf8' }).trim();
          if (modifiedFiles) {
            this.log(`Modified files: ${modifiedFiles.split('\n').join(', ')}`);
          }
          
          const stagedFiles = execSync('git diff --cached --name-only', { encoding: 'utf8' }).trim();
          if (stagedFiles) {
            this.log(`Staged files: ${stagedFiles.split('\n').join(', ')}`);
          }
        } catch (e) {
          this.log('Could not determine modified files');
        }
      }
      
    } catch (error) {
      this.log(`Git information error: ${error.message}`);
    }
  }

  async analyzeBlobSHAs() {
    this.log('\n=== GIT BLOB SHA ANALYSIS ===');
    
    try {
      // Analyze static template blob SHA
      if (fs.existsSync(this.staticTemplateFile)) {
        const staticBlobSHA = execSync(`git hash-object ${this.staticTemplateFile}`, { encoding: 'utf8' }).trim();
        this.log(`Static template blob SHA: ${staticBlobSHA}`);
        
        // Check if this blob exists in the current commit
        try {
          const committedBlobSHA = execSync(`git rev-parse HEAD:${this.staticTemplateFile}`, { encoding: 'utf8' }).trim();
          this.log(`Committed static template blob SHA: ${committedBlobSHA}`);
          this.log(`Static template matches committed: ${staticBlobSHA === committedBlobSHA ? 'YES' : 'NO'}`);
          
          if (staticBlobSHA !== committedBlobSHA) {
            this.log('Static template has uncommitted changes!');
          }
        } catch (e) {
          this.log('Could not get committed blob SHA for static template');
        }
      }
      
      // Analyze generated template blob SHA
      const generatedTemplate = path.join(this.cdkOutDir, 'multi-az-workshop.template.json');
      if (fs.existsSync(generatedTemplate)) {
        const generatedBlobSHA = execSync(`git hash-object ${generatedTemplate}`, { encoding: 'utf8' }).trim();
        this.log(`Generated template blob SHA: ${generatedBlobSHA}`);
        
        // Compare with static template
        if (fs.existsSync(this.staticTemplateFile)) {
          const staticBlobSHA = execSync(`git hash-object ${this.staticTemplateFile}`, { encoding: 'utf8' }).trim();
          this.log(`Generated vs Static blob SHA match: ${generatedBlobSHA === staticBlobSHA ? 'YES' : 'NO'}`);
        }
      }
      
      // Analyze key CDK output files
      const keyFiles = [
        'multi-az-workshop.assets.json',
        'manifest.json'
      ];
      
      keyFiles.forEach(file => {
        const filePath = path.join(this.cdkOutDir, file);
        if (fs.existsSync(filePath)) {
          try {
            const blobSHA = execSync(`git hash-object ${filePath}`, { encoding: 'utf8' }).trim();
            this.log(`${file} blob SHA: ${blobSHA}`);
          } catch (error) {
            this.log(`${file} blob SHA: Error - ${error.message}`);
          }
        }
      });
      
    } catch (error) {
      this.log(`Blob SHA analysis error: ${error.message}`);
    }
  }

  async analyzeCommitHistory() {
    this.log('\n=== COMMIT HISTORY FOR STATIC TEMPLATE ===');
    
    try {
      // Get recent commits that modified the static template
      const commitHistory = execSync(`git log --oneline -10 -- ${this.staticTemplateFile}`, { encoding: 'utf8' }).trim();
      if (commitHistory) {
        this.log('Recent commits affecting static template:');
        commitHistory.split('\n').forEach(line => {
          this.log(`  ${line}`);
        });
        
        // Get the blob SHA for the static template in the last few commits
        const recentCommits = commitHistory.split('\n').slice(0, 3);
        for (const commitLine of recentCommits) {
          const commitHash = commitLine.split(' ')[0];
          try {
            const blobSHA = execSync(`git rev-parse ${commitHash}:${this.staticTemplateFile}`, { encoding: 'utf8' }).trim();
            this.log(`  Commit ${commitHash} - blob SHA: ${blobSHA}`);
          } catch (e) {
            this.log(`  Commit ${commitHash} - blob SHA: Not found`);
          }
        }
      } else {
        this.log('No commit history found for static template');
      }
      
    } catch (error) {
      this.log(`Commit history analysis error: ${error.message}`);
    }
  }

  async simulateGitDiffStaged() {
    this.log('\n=== SIMULATED GIT DIFF STAGED ANALYSIS ===');
    
    try {
      // Stage the generated template to simulate what CI would see
      const generatedTemplate = path.join(this.cdkOutDir, 'multi-az-workshop.template.json');
      if (fs.existsSync(generatedTemplate) && fs.existsSync(this.staticTemplateFile)) {
        
        // Copy generated template over static template temporarily
        const staticBackup = `${this.staticTemplateFile}.backup`;
        fs.copyFileSync(this.staticTemplateFile, staticBackup);
        fs.copyFileSync(generatedTemplate, this.staticTemplateFile);
        
        try {
          // Stage the file
          execSync(`git add ${this.staticTemplateFile}`, { encoding: 'utf8' });
          
          // Check if there are staged changes
          try {
            execSync('git diff --staged --quiet', { encoding: 'utf8' });
            this.log('No staged changes detected (templates are identical)');
          } catch (diffError) {
            this.log('Staged changes detected!');
            
            // Get the diff stats
            const diffStats = execSync('git diff --staged --stat', { encoding: 'utf8' }).trim();
            this.log(`Diff stats: ${diffStats}`);
            
            // Get blob SHAs for old and new
            const oldBlobSHA = execSync(`git rev-parse HEAD:${this.staticTemplateFile}`, { encoding: 'utf8' }).trim();
            const newBlobSHA = execSync(`git hash-object ${this.staticTemplateFile}`, { encoding: 'utf8' }).trim();
            
            this.log(`Old blob SHA (HEAD): ${oldBlobSHA}`);
            this.log(`New blob SHA (staged): ${newBlobSHA}`);
            
            // Get a sample of the diff (first 20 lines)
            try {
              const diffSample = execSync('git diff --staged --unified=1', { encoding: 'utf8' });
              const diffLines = diffSample.split('\n').slice(0, 20);
              this.log('Sample diff (first 20 lines):');
              diffLines.forEach(line => {
                this.log(`  ${line}`);
              });
            } catch (e) {
              this.log('Could not generate diff sample');
            }
          }
          
          // Reset the staged changes
          execSync(`git reset HEAD ${this.staticTemplateFile}`, { encoding: 'utf8' });
          
        } finally {
          // Restore the original static template
          fs.copyFileSync(staticBackup, this.staticTemplateFile);
          fs.unlinkSync(staticBackup);
        }
      } else {
        this.log('Cannot simulate git diff - missing template files');
      }
      
    } catch (error) {
      this.log(`Git diff simulation error: ${error.message}`);
    }
  }

  async analyzeAssetManifest() {
    this.log('\n=== ASSET MANIFEST ANALYSIS ===');
    
    if (!fs.existsSync(this.assetManifestFile)) {
      this.log(`Asset manifest not found: ${this.assetManifestFile}`);
      return;
    }

    try {
      const manifestContent = fs.readFileSync(this.assetManifestFile, 'utf8');
      const manifest = JSON.parse(manifestContent);
      
      this.log(`CDK version in manifest: ${manifest.version}`);
      this.log(`Total assets: ${Object.keys(manifest.files).length}`);
      
      // Analyze each asset
      this.log('\nAsset details:');
      Object.entries(manifest.files).forEach(([hash, asset]) => {
        this.log(`  Hash: ${hash}`);
        this.log(`    Display Name: ${asset.displayName}`);
        this.log(`    Source Path: ${asset.source.path}`);
        this.log(`    Packaging: ${asset.source.packaging}`);
        
        // Check if source file exists and get its metadata
        const sourcePath = path.join(this.cdkOutDir, asset.source.path);
        if (fs.existsSync(sourcePath)) {
          const stats = fs.statSync(sourcePath);
          this.log(`    File Size: ${stats.size} bytes`);
          this.log(`    Modified: ${stats.mtime.toISOString()}`);
          
          // Calculate actual file hash for comparison
          const actualHash = this.calculateFileHash(sourcePath);
          this.log(`    Actual SHA256: ${actualHash}`);
          this.log(`    Hash Match: ${hash === actualHash ? 'YES' : 'NO'}`);
        } else {
          this.log(`    Source file not found: ${sourcePath}`);
        }
      });
      
    } catch (error) {
      this.log(`Error analyzing asset manifest: ${error.message}`);
    }
  }

  calculateFileHash(filePath) {
    try {
      const content = fs.readFileSync(filePath);
      return crypto.createHash('sha256').update(content).digest('hex');
    } catch (error) {
      return `Error: ${error.message}`;
    }
  }

  async analyzeNestedStackTemplates() {
    this.log('\n=== NESTED STACK TEMPLATE ANALYSIS ===');
    
    const templateFiles = fs.readdirSync(this.cdkOutDir)
      .filter(file => file.endsWith('.nested.template.json'))
      .sort();
    
    this.log(`Found ${templateFiles.length} nested stack templates`);
    
    // Focus on az-tagger template as mentioned in the task
    const azTaggerTemplate = templateFiles.find(file => file.includes('aztagger'));
    if (azTaggerTemplate) {
      this.log(`\nAnalyzing az-tagger template: ${azTaggerTemplate}`);
      this.analyzeTemplateContent(path.join(this.cdkOutDir, azTaggerTemplate));
    }
    
    // Analyze a few other templates for patterns
    templateFiles.slice(0, 3).forEach(templateFile => {
      if (!templateFile.includes('aztagger')) {
        this.log(`\nAnalyzing template: ${templateFile}`);
        this.analyzeTemplateContent(path.join(this.cdkOutDir, templateFile));
      }
    });
  }

  analyzeTemplateContent(templatePath) {
    try {
      const content = fs.readFileSync(templatePath, 'utf8');
      const template = JSON.parse(content);
      
      // Look for potential sources of non-determinism
      this.log(`  Template size: ${content.length} characters`);
      
      // Check for timestamps
      const timestampMatches = content.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g);
      if (timestampMatches) {
        this.log(`  Found ${timestampMatches.length} timestamp(s): ${timestampMatches.slice(0, 3).join(', ')}`);
      }
      
      // Check for metadata that might vary
      if (template.Metadata) {
        this.log(`  Metadata keys: ${Object.keys(template.Metadata).join(', ')}`);
      }
      
      // Check for asset references
      const assetRefs = content.match(/[a-f0-9]{64}/g);
      if (assetRefs) {
        this.log(`  Asset references found: ${assetRefs.length}`);
        this.log(`  First few hashes: ${assetRefs.slice(0, 3).join(', ')}`);
      }
      
      // Look for environment-specific content
      const envPatterns = [
        /\$\{AWS::/g,
        /\$\{AssetsBucket/g,
        /current_account/g,
        /current_region/g
      ];
      
      envPatterns.forEach((pattern, index) => {
        const matches = content.match(pattern);
        if (matches) {
          this.log(`  Environment pattern ${index + 1} matches: ${matches.length}`);
        }
      });
      
    } catch (error) {
      this.log(`  Error analyzing template: ${error.message}`);
    }
  }

  async compareWithStaticTemplate() {
    this.log('\n=== STATIC TEMPLATE COMPARISON ===');
    
    if (!fs.existsSync(this.staticTemplateFile)) {
      this.log(`Static template not found: ${this.staticTemplateFile}`);
      return;
    }

    try {
      const staticContent = fs.readFileSync(this.staticTemplateFile, 'utf8');
      const mainTemplate = path.join(this.cdkOutDir, 'multi-az-workshop.template.json');
      
      if (!fs.existsSync(mainTemplate)) {
        this.log(`Main template not found: ${mainTemplate}`);
        return;
      }
      
      const mainContent = fs.readFileSync(mainTemplate, 'utf8');
      
      this.log(`Static template size: ${staticContent.length} characters`);
      this.log(`Generated template size: ${mainContent.length} characters`);
      
      // Extract asset hashes from both
      const staticHashes = staticContent.match(/[a-f0-9]{64}/g) || [];
      const generatedHashes = mainContent.match(/[a-f0-9]{64}/g) || [];
      
      this.log(`Static template asset hashes: ${staticHashes.length}`);
      this.log(`Generated template asset hashes: ${generatedHashes.length}`);
      
      // Find differences
      const staticHashSet = new Set(staticHashes);
      const generatedHashSet = new Set(generatedHashes);
      
      const onlyInStatic = [...staticHashSet].filter(h => !generatedHashSet.has(h));
      const onlyInGenerated = [...generatedHashSet].filter(h => !staticHashSet.has(h));
      
      if (onlyInStatic.length > 0) {
        this.log(`Hashes only in static template: ${onlyInStatic.slice(0, 5).join(', ')}`);
      }
      
      if (onlyInGenerated.length > 0) {
        this.log(`Hashes only in generated template: ${onlyInGenerated.slice(0, 5).join(', ')}`);
      }
      
      if (onlyInStatic.length === 0 && onlyInGenerated.length === 0) {
        this.log('All asset hashes match between static and generated templates');
      }
      
    } catch (error) {
      this.log(`Error comparing templates: ${error.message}`);
    }
  }

  async collectFileSystemInfo() {
    this.log('\n=== FILE SYSTEM INFORMATION ===');
    
    // Check cdk.out directory
    if (fs.existsSync(this.cdkOutDir)) {
      const files = fs.readdirSync(this.cdkOutDir);
      this.log(`CDK output directory contains ${files.length} files`);
      
      // Get modification times of key files
      const keyFiles = [
        'multi-az-workshop.template.json',
        'multi-az-workshop.assets.json',
        'manifest.json'
      ];
      
      keyFiles.forEach(file => {
        const filePath = path.join(this.cdkOutDir, file);
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          this.log(`  ${file}: ${stats.mtime.toISOString()} (${stats.size} bytes)`);
        }
      });
    }
    
    // Check for temporary files or directories that might affect builds
    const tempDirs = ['tmp', '.tmp', 'node_modules/.cache'];
    tempDirs.forEach(dir => {
      if (fs.existsSync(dir)) {
        const stats = fs.statSync(dir);
        this.log(`Temp directory ${dir}: modified ${stats.mtime.toISOString()}`);
      }
    });
  }

  async run() {
    // Clear previous output
    if (fs.existsSync(this.outputFile)) {
      fs.unlinkSync(this.outputFile);
    }
    
    this.log('CDK Asset Hash Debugging Utility');
    this.log('================================');
    
    await this.collectEnvironmentInfo();
    await this.collectGitInformation();
    await this.analyzeBlobSHAs();
    await this.analyzeCommitHistory();
    await this.collectFileSystemInfo();
    await this.analyzeAssetManifest();
    await this.analyzeNestedStackTemplates();
    await this.compareWithStaticTemplate();
    await this.simulateGitDiffStaged();
    
    this.log('\n=== DEBUG COMPLETE ===');
    this.log(`Full output saved to: ${this.outputFile}`);
  }
}

// Run the debugger
if (require.main === module) {
  const assetDebugger = new AssetHashDebugger();
  assetDebugger.run().catch(error => {
    console.error('Debug script failed:', error);
    process.exit(1);
  });
}

module.exports = AssetHashDebugger;