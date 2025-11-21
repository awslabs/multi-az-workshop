# Requirements Document

## Introduction

This document outlines the requirements for converting the Multi-AZ Workshop CDK project from C# to TypeScript. The project is a comprehensive AWS CDK application that deploys a multi-availability zone architecture with observability, fault injection, and deployment automation capabilities. The conversion must maintain functional equivalence while adopting TypeScript idioms and best practices.

## Glossary

- **CDK (Cloud Development Kit)**: AWS infrastructure-as-code framework that allows defining cloud resources using programming languages
- **Multi-AZ Workshop Application**: The target application being converted, which demonstrates multi-availability zone resilience patterns
- **Source Project**: The existing C# CDK implementation located in the `cdk/` directory
- **Target Project**: The new TypeScript CDK implementation that will replace the C# version
- **Construct**: A CDK component that represents one or more AWS resources
- **Nested Stack**: A CloudFormation stack that is created as part of another stack
- **L1 Construct**: Low-level CDK construct that directly maps to CloudFormation resources
- **L2 Construct**: Higher-level CDK construct with sensible defaults and helper methods
- **L3 Construct**: Pattern-based construct that combines multiple L2 constructs

## Requirements

### Requirement 1

**User Story:** As a developer, I want the TypeScript CDK project to have the same functional output as the C# version, so that the deployed infrastructure remains identical.

#### Acceptance Criteria

1. WHEN THE Target Project synthesizes CloudFormation templates, THE Target Project SHALL produce templates functionally equivalent to those produced by the Source Project
2. WHEN THE Target Project deploys to AWS, THE Target Project SHALL create the same AWS resources with the same configurations as the Source Project
3. WHEN THE Target Project references CDK constructs, THE Target Project SHALL use the same CDK library versions as specified in the Source Project dependencies
4. THE Target Project SHALL maintain all CloudFormation parameters defined in the Source Project with identical names and default values
5. THE Target Project SHALL preserve all resource naming conventions, tags, and metadata from the Source Project

### Requirement 2

**User Story:** As a developer, I want all custom constructs converted to TypeScript, so that the project architecture remains modular and maintainable.

#### Acceptance Criteria

1. THE Target Project SHALL convert all 13 custom construct files from the `Constructs/` directory to TypeScript equivalents
2. WHEN a custom construct in the Source Project extends a CDK base class, THE Target Project SHALL extend the equivalent TypeScript CDK base class
3. THE Target Project SHALL preserve all constructor parameters, properties, and methods from each Source Project construct
4. THE Target Project SHALL maintain the same interface contracts and type definitions as the Source Project constructs
5. THE Target Project SHALL organize converted constructs in a `lib/constructs/` directory structure

### Requirement 3

**User Story:** As a developer, I want all nested stacks converted to TypeScript, so that the deployment architecture remains consistent.

#### Acceptance Criteria

1. THE Target Project SHALL convert all 15 nested stack files from the `NestedStacks/` directory to TypeScript equivalents
2. WHEN a nested stack in the Source Project defines CloudFormation outputs, THE Target Project SHALL define identical outputs
3. THE Target Project SHALL preserve all inter-stack dependencies and references from the Source Project
4. THE Target Project SHALL maintain the same stack naming conventions as the Source Project
5. THE Target Project SHALL organize converted nested stacks in a `lib/nested-stacks/` directory structure

### Requirement 4

**User Story:** As a developer, I want the project structure to follow TypeScript CDK conventions, so that the codebase is familiar to TypeScript developers.

#### Acceptance Criteria

1. THE Target Project SHALL use a `package.json` file for dependency management instead of a `.csproj` file
2. THE Target Project SHALL define the CDK app entry point in a `bin/` directory following TypeScript CDK conventions
3. THE Target Project SHALL place all stack and construct code in a `lib/` directory
4. THE Target Project SHALL use TypeScript configuration via `tsconfig.json` with strict type checking enabled
5. THE Target Project SHALL include npm scripts for common operations including build, synth, deploy, and test

### Requirement 5

**User Story:** As a developer, I want all type definitions properly converted, so that the TypeScript compiler can validate the code.

#### Acceptance Criteria

1. WHEN the Source Project uses C# enums, THE Target Project SHALL use TypeScript enums or string literal unions as appropriate
2. WHEN the Source Project uses C# interfaces, THE Target Project SHALL use TypeScript interfaces with equivalent type constraints
3. THE Target Project SHALL use TypeScript generic types where the Source Project uses C# generics
4. THE Target Project SHALL define all custom types and interfaces in appropriate declaration files
5. THE Target Project SHALL compile without TypeScript errors when strict mode is enabled

### Requirement 6

**User Story:** As a developer, I want all Lambda function references and asset paths updated, so that the deployment can locate all required files.

#### Acceptance Criteria

1. THE Target Project SHALL reference the same Lambda function source code files as the Source Project
2. WHEN the Source Project references asset paths using string interpolation, THE Target Project SHALL use equivalent path resolution
3. THE Target Project SHALL maintain references to all Python Lambda functions in `az-tagger-src/` and `uploader-src/` directories
4. THE Target Project SHALL preserve all CloudFormation parameter substitutions for asset bucket names and prefixes
5. THE Target Project SHALL reference configuration files in the `Configs/` directory using the same relative paths

### Requirement 7

**User Story:** As a developer, I want the CDK context and configuration preserved, so that the deployment behavior remains consistent.

#### Acceptance Criteria

1. THE Target Project SHALL preserve all CDK context values from the `cdk.json` file
2. THE Target Project SHALL maintain the same CDK feature flags as the Source Project
3. THE Target Project SHALL use the same asset publishing configuration as the Source Project
4. THE Target Project SHALL preserve the custom synthesizer configuration with identical bucket naming patterns
5. THE Target Project SHALL maintain all environment variable references and AWS region configurations

### Requirement 8

**User Story:** As a developer, I want comprehensive documentation for the converted project, so that future maintainers understand the TypeScript implementation.

#### Acceptance Criteria

1. THE Target Project SHALL include a README file documenting the TypeScript project structure and build process
2. THE Target Project SHALL document all npm scripts and their purposes
3. THE Target Project SHALL include inline code comments explaining complex logic converted from C#
4. THE Target Project SHALL document any TypeScript-specific patterns or idioms used in the conversion
5. THE Target Project SHALL provide migration notes highlighting differences between the C# and TypeScript implementations

### Requirement 9

**User Story:** As a developer, I want the build and deployment process documented, so that I can successfully build and deploy the TypeScript CDK application.

#### Acceptance Criteria

1. THE Target Project SHALL document all prerequisite software and versions required for building
2. THE Target Project SHALL provide step-by-step instructions for installing dependencies
3. THE Target Project SHALL document the commands for synthesizing CloudFormation templates
4. THE Target Project SHALL document the commands for deploying the application to AWS
5. THE Target Project SHALL document how to run any validation or testing procedures

### Requirement 10

**User Story:** As a developer, I want the TypeScript code to follow best practices, so that the codebase is maintainable and idiomatic.

#### Acceptance Criteria

1. THE Target Project SHALL use async/await patterns where the Source Project uses synchronous C# code
2. THE Target Project SHALL use TypeScript's optional chaining and nullish coalescing operators where appropriate
3. THE Target Project SHALL follow consistent naming conventions with camelCase for variables and PascalCase for classes
4. THE Target Project SHALL use ES6 module imports instead of C# using statements
5. THE Target Project SHALL organize imports in a consistent order with external dependencies before internal modules

### Requirement 11

**User Story:** As a developer, I want the project managed with Projen, so that project configuration and build processes are automated and maintainable.

#### Acceptance Criteria

1. THE Target Project SHALL use Projen to manage the TypeScript CDK project configuration
2. THE Target Project SHALL define all project dependencies, scripts, and configuration through a `.projenrc.ts` file
3. WHEN Projen generates project files, THE Target Project SHALL include all necessary TypeScript, ESLint, and Jest configurations
4. THE Target Project SHALL use Projen's AwsCdkTypeScriptApp project type with appropriate settings
5. THE Target Project SHALL configure Projen to maintain consistency between generated files and source configuration

### Requirement 12

**User Story:** As a developer, I want NPX scripts that mirror GitHub workflows, so that I can run the same build and validation steps locally.

#### Acceptance Criteria

1. THE Target Project SHALL provide NPX scripts that replicate all build steps from the GitHub workflows
2. WHEN a GitHub workflow performs linting, THE Target Project SHALL provide an equivalent NPX script for local linting
3. WHEN a GitHub workflow performs testing, THE Target Project SHALL provide an equivalent NPX script for local testing
4. WHEN a GitHub workflow performs CDK synthesis, THE Target Project SHALL provide an equivalent NPX script for local synthesis
5. THE Target Project SHALL document all NPX scripts with descriptions of their purposes and how they correspond to CI/CD workflows
