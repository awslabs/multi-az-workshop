#!/usr/bin/env node

/**
 * CDK Asset Content Comparison Utility
 * 
 * This script performs detailed comparison of CDK asset contents to identify
 * patterns in differences between environments (timestamps, ordering, metadata).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class AssetContentComparator {
  constructor() {
    this.outputFile = 'asset-comparison-output.txt';
    this.cdkOutDir = 'cdk.out';
    this.assetManifestFile = path.join(this.cdkOutDir, 'multi-az-workshop.assets.json');
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    fs.appendFileSync(this.outputFile, logMessage + '\n');
  }

  async analyzeNestedStackTemplates() {
    this.log('=== NESTED STACK TEMPLATE CONTENT ANALYSIS ===');
    
    const templateFiles = fs.readdirSync(this.cdkOutDir)
      .filter(file => file.endsWith('.nested.template.json'))
      .sort();
    
    this.log(`Found ${templateFiles.length} nested stack templates`);
    
    // Focus on az-tagger template first as mentioned in the task
    const azTaggerTemplate = templateFiles.find(file => file.includes('aztagger'));
    if (azTaggerTemplate) {
      this.log(`\n=== DETAILED ANALYSIS: ${azTaggerTemplate} ===`);
      await this.analyzeTemplateForNonDeterminism(path.join(this.cdkOutDir, azTaggerTemplate));
    }
    
    // Analyze a few other key templates
    const keyTemplates = templateFiles.filter(file => 
      file.includes('network') || 
      file.includes('database') || 
      file.includes('ecruploader')
    ).slice(0, 3);
    
    for (const templateFile of keyTemplates) {
      this.log(`\n=== DETAILED ANALYSIS: ${templateFile} ===`);
      await this.analyzeTemplateForNonDeterminism(path.join(this.cdkOutDir, templateFile));
    }
  }

  async analyzeTemplateForNonDeterminism(templatePath) {
    try {
      const content = fs.readFileSync(templatePath, 'utf8');
      const template = JSON.parse(content);
      
      this.log(`Template: ${path.basename(templatePath)}`);
      this.log(`Size: ${content.length} characters`);
      
      // 1. Check for timestamps
      this.analyzeTimestamps(content);
      
      // 2. Check for environment-specific content
      this.analyzeEnvironmentSpecificContent(content);
      
      // 3. Check for asset references and their patterns
      this.analyzeAssetReferences(content);
      
      // 4. Check for metadata that might vary
      this.analyzeMetadata(template);
      
      // 5. Check for ordering issues
      this.analyzeOrdering(template);
      
      // 6. Check for CDK-specific patterns
      this.analyzeCdkPatterns(content);
      
      // 7. Generate content fingerprint
      this.generateContentFingerprint(content, path.basename(templatePath));
      
    } catch (error) {
      this.log(`  Error analyzing template: ${error.message}`);
    }
  }

  analyzeTimestamps(content) {
    this.log(`\n  --- TIMESTAMP ANALYSIS ---`);
    
    // Look for various timestamp patterns
    const timestampPatterns = [
      { name: 'ISO 8601', regex: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?/g },
      { name: 'Unix timestamp', regex: /\b\d{10,13}\b/g },
      { name: 'Date strings', regex: /\b\d{4}-\d{2}-\d{2}\b/g },
      { name: 'Time strings', regex: /\b\d{2}:\d{2}:\d{2}\b/g }
    ];
    
    let foundTimestamps = false;
    timestampPatterns.forEach(pattern => {
      const matches = content.match(pattern.regex);
      if (matches && matches.length > 0) {
        foundTimestamps = true;
        this.log(`    ${pattern.name}: ${matches.length} matches`);
        this.log(`    Examples: ${matches.slice(0, 3).join(', ')}`);
      }
    });
    
    if (!foundTimestamps) {
      this.log(`    No timestamps found`);
    }
  }

  analyzeEnvironmentSpecificContent(content) {
    this.log(`\n  --- ENVIRONMENT-SPECIFIC CONTENT ---`);
    
    const envPatterns = [
      { name: 'AWS Pseudo Parameters', regex: /\$\{AWS::[^}]+\}/g },
      { name: 'Assets Bucket References', regex: /\$\{AssetsBucket[^}]*\}/g },
      { name: 'Current Account/Region', regex: /current_(account|region)/g },
      { name: 'CDK Bootstrap', regex: /cdk-[a-z0-9]+-/g },
      { name: 'Random Suffixes', regex: /[A-Z0-9]{8,}/g }
    ];
    
    envPatterns.forEach(pattern => {
      const matches = content.match(pattern.regex);
      if (matches && matches.length > 0) {
        this.log(`    ${pattern.name}: ${matches.length} matches`);
        if (matches.length <= 5) {
          this.log(`    Values: ${matches.join(', ')}`);
        } else {
          this.log(`    Sample values: ${matches.slice(0, 3).join(', ')}`);
        }
      }
    });
  }

  analyzeAssetReferences(content) {
    this.log(`\n  --- ASSET REFERENCE ANALYSIS ---`);
    
    const assetHashes = content.match(/[a-f0-9]{64}/g) || [];
    this.log(`    Asset hashes found: ${assetHashes.length}`);
    
    if (assetHashes.length > 0) {
      this.log(`    Unique hashes: ${new Set(assetHashes).size}`);
      this.log(`    Sample hashes: ${assetHashes.slice(0, 2).join(', ')}`);
      
      // Check if hashes appear in specific contexts
      const contexts = [
        { name: 'S3 Object Keys', regex: /ObjectKey[^,}]*[a-f0-9]{64}/g },
        { name: 'Code URIs', regex: /Code[^,}]*[a-f0-9]{64}/g },
        { name: 'Template URLs', regex: /TemplateURL[^,}]*[a-f0-9]{64}/g }
      ];
      
      contexts.forEach(context => {
        const matches = content.match(context.regex);
        if (matches) {
          this.log(`    ${context.name}: ${matches.length} references`);
        }
      });
    }
  }

  analyzeMetadata(template) {
    this.log(`\n  --- METADATA ANALYSIS ---`);
    
    if (template.Metadata) {
      this.log(`    Root metadata keys: ${Object.keys(template.Metadata).join(', ')}`);
    }
    
    // Check for metadata in resources
    let resourcesWithMetadata = 0;
    let metadataKeys = new Set();
    
    if (template.Resources) {
      Object.values(template.Resources).forEach(resource => {
        if (resource.Metadata) {
          resourcesWithMetadata++;
          Object.keys(resource.Metadata).forEach(key => metadataKeys.add(key));
        }
      });
    }
    
    this.log(`    Resources with metadata: ${resourcesWithMetadata}`);
    if (metadataKeys.size > 0) {
      this.log(`    Metadata keys: ${Array.from(metadataKeys).join(', ')}`);
    }
  }

  analyzeOrdering(template) {
    this.log(`\n  --- ORDERING ANALYSIS ---`);
    
    if (template.Resources) {
      const resourceNames = Object.keys(template.Resources);
      this.log(`    Resource count: ${resourceNames.length}`);
      this.log(`    First few resources: ${resourceNames.slice(0, 3).join(', ')}`);
      
      // Check if resources are sorted
      const sortedNames = [...resourceNames].sort();
      const isSorted = JSON.stringify(resourceNames) === JSON.stringify(sortedNames);
      this.log(`    Resources are sorted: ${isSorted}`);
    }
    
    if (template.Parameters) {
      const paramNames = Object.keys(template.Parameters);
      this.log(`    Parameter count: ${paramNames.length}`);
      this.log(`    Parameters: ${paramNames.join(', ')}`);
    }
  }

  analyzeCdkPatterns(content) {
    this.log(`\n  --- CDK-SPECIFIC PATTERNS ---`);
    
    const cdkPatterns = [
      { name: 'CDK Path metadata', regex: /"aws:cdk:path":\s*"[^"]+"/g },
      { name: 'CDK Asset metadata', regex: /"aws:cdk:asset:[^"]+"/g },
      { name: 'CDK Logical IDs', regex: /[A-Z][a-zA-Z0-9]*[A-F0-9]{8}/g },
      { name: 'CDK Construct IDs', regex: /"ConstructId":\s*"[^"]+"/g }
    ];
    
    cdkPatterns.forEach(pattern => {
      const matches = content.match(pattern.regex);
      if (matches && matches.length > 0) {
        this.log(`    ${pattern.name}: ${matches.length} matches`);
        if (matches.length <= 3) {
          this.log(`    Examples: ${matches.join(', ')}`);
        }
      }
    });
  }

  generateContentFingerprint(content, templateName) {
    this.log(`\n  --- CONTENT FINGERPRINT ---`);
    
    // Generate various hashes to help identify what changes
    const fullHash = crypto.createHash('sha256').update(content).digest('hex');
    this.log(`    Full content SHA256: ${fullHash}`);
    
    // Hash without whitespace
    const normalizedContent = content.replace(/\s+/g, ' ').trim();
    const normalizedHash = crypto.createHash('sha256').update(normalizedContent).digest('hex');
    this.log(`    Normalized content SHA256: ${normalizedHash}`);
    
    // Hash without asset references
    const contentWithoutAssets = content.replace(/[a-f0-9]{64}/g, 'ASSET_HASH');
    const noAssetsHash = crypto.createHash('sha256').update(contentWithoutAssets).digest('hex');
    this.log(`    Content without assets SHA256: ${noAssetsHash}`);
    
    // Hash of just the structure (keys only)
    try {
      const parsed = JSON.parse(content);
      const structure = this.extractStructure(parsed);
      const structureHash = crypto.createHash('sha256').update(JSON.stringify(structure)).digest('hex');
      this.log(`    Structure-only SHA256: ${structureHash}`);
    } catch (error) {
      this.log(`    Structure hash failed: ${error.message}`);
    }
  }

  extractStructure(obj, depth = 0) {
    if (depth > 10) return '[deep]'; // Prevent infinite recursion
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.extractStructure(item, depth + 1));
    } else if (obj && typeof obj === 'object') {
      const result = {};
      Object.keys(obj).sort().forEach(key => {
        result[key] = this.extractStructure(obj[key], depth + 1);
      });
      return result;
    } else {
      return typeof obj;
    }
  }

  async compareWithCommittedVersion() {
    this.log(`\n=== COMPARISON WITH COMMITTED STATIC TEMPLATE ===`);
    
    const staticTemplatePath = 'static/multi-az-workshop.json';
    const generatedTemplatePath = path.join(this.cdkOutDir, 'multi-az-workshop.template.json');
    
    if (!fs.existsSync(staticTemplatePath) || !fs.existsSync(generatedTemplatePath)) {
      this.log('Cannot compare - missing template files');
      return;
    }
    
    const staticContent = fs.readFileSync(staticTemplatePath, 'utf8');
    const generatedContent = fs.readFileSync(generatedTemplatePath, 'utf8');
    
    this.log(`Static template size: ${staticContent.length} characters`);
    this.log(`Generated template size: ${generatedContent.length} characters`);
    
    if (staticContent === generatedContent) {
      this.log('Templates are identical');
      return;
    }
    
    // Find differences
    this.log('\nAnalyzing differences...');
    
    // Compare line by line
    const staticLines = staticContent.split('\n');
    const generatedLines = generatedContent.split('\n');
    
    let differences = 0;
    const maxLinesToCheck = Math.max(staticLines.length, generatedLines.length);
    
    for (let i = 0; i < maxLinesToCheck && differences < 10; i++) {
      const staticLine = staticLines[i] || '';
      const generatedLine = generatedLines[i] || '';
      
      if (staticLine !== generatedLine) {
        differences++;
        this.log(`  Line ${i + 1}:`);
        this.log(`    Static:    ${staticLine.substring(0, 100)}${staticLine.length > 100 ? '...' : ''}`);
        this.log(`    Generated: ${generatedLine.substring(0, 100)}${generatedLine.length > 100 ? '...' : ''}`);
      }
    }
    
    if (differences === 0) {
      this.log('No line differences found (templates may differ in line endings)');
    } else {
      this.log(`Found ${differences} line differences (showing first 10)`);
    }
  }

  async run() {
    // Clear previous output
    if (fs.existsSync(this.outputFile)) {
      fs.unlinkSync(this.outputFile);
    }
    
    this.log('CDK Asset Content Comparison Utility');
    this.log('===================================');
    
    await this.analyzeNestedStackTemplates();
    await this.compareWithCommittedVersion();
    
    this.log('\n=== ANALYSIS COMPLETE ===');
    this.log(`Full output saved to: ${this.outputFile}`);
  }
}

// Run the comparator
if (require.main === module) {
  const comparator = new AssetContentComparator();
  comparator.run().catch(error => {
    console.error('Comparison script failed:', error);
    process.exit(1);
  });
}

module.exports = AssetContentComparator;