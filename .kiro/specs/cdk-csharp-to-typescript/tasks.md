# Implementation Plan

- [x] 1. Set up Git branch and project structure
  - Create feature branch `feature/cdk-typescript-conversion` from main
  - Initialize Projen TypeScript CDK project in a temporary directory
  - Configure Projen with AwsCdkTypeScriptApp project type
  - Set CDK version to 2.189.1 to match C# project
  - Configure TypeScript with strict mode enabled
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 11.1, 11.2, 11.3, 11.4_

- [x] 1.1 Configure Projen dependencies and settings
  - Add cdklabs.multi-az-observability@0.0.1-alpha.60 dependency
  - Add @aws-cdk/lambda-layer-kubectl-v31 dependency
  - Configure tsconfig.json with ES2020 target and strict mode
  - Set up ESLint and Prettier configurations
  - Configure Jest for testing
  - _Requirements: 1.3, 4.5, 5.5, 11.3_

- [x] 1.2 Set up directory structure
  - Create bin/ directory for CDK app entry point
  - Create lib/ directory for stack and construct code
  - Create lib/constructs/ directory for custom constructs
  - Create lib/nested-stacks/ directory for nested stacks
  - Create lib/types/ directory for type definitions
  - Create lib/utils/ directory for utility functions
  - Preserve configs/, az-tagger-src/, and uploader-src/ directories
  - _Requirements: 4.2, 4.3, 6.3_

- [x] 1.3 Configure CDK context and settings
  - Copy cdk.json from C# project
  - Preserve all CDK context values and feature flags
  - Configure asset publishing settings
  - Set up custom synthesizer configuration
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 2. Convert type definitions and enums
  - Create lib/types/evacuation-method.ts with EvacuationMethod enum
  - Convert InstanceArchitecture enum if needed
  - Create lib/types/index.ts to export all types
  - Define interfaces for stack props and construct props
  - _Requirements: 5.1, 5.2, 5.4_

- [ ] 2.1 Create CDK app entry point
  - Create bin/multi-az-workshop.ts file
  - Import CDK App class and main stack
  - Instantiate App with proper configuration
  - Create MultiAZWorkshopStack with stack props
  - Configure DefaultStackSynthesizer with bucket naming patterns
  - Call app.synth()
  - _Requirements: 1.1, 1.4, 4.2, 7.4_

- [ ] 2.2 Create main stack skeleton
  - Create lib/multi-az-workshop-stack.ts file
  - Define MultiAZWorkshopStackProps interface
  - Create MultiAZWorkshopStack class extending cdk.Stack
  - Add CloudFormation parameters (AssetsBucketName, AssetsBucketPrefix, ParticipantRoleName)
  - Define constants (availabilityZoneNames, fleetSize, domain, etc.)
  - _Requirements: 1.4, 1.5, 2.3, 4.3_

- [ ] 3. Convert utility functions
  - Create lib/utils/service-factory.ts file
  - Extract CreateService method from main stack
  - Define CreateServiceOptions interface
  - Convert service creation logic to TypeScript
  - Convert operation definitions (Signin, Pay, Ride, Home)
  - Use proper TypeScript types for all parameters
  - _Requirements: 2.3, 2.4, 5.2, 10.1, 10.3_

- [ ] 4. Convert custom constructs - Part 1 (Leaf constructs)
  - Convert lib/constructs/ip-address-type.ts (enum/type)
  - Convert lib/constructs/network-builder.ts
  - Convert lib/constructs/vpc-ipv6-construct.ts
  - Convert lib/constructs/container-and-repo.ts
  - Convert lib/constructs/helm-repo-and-chart.ts
  - Each construct must extend Construct base class
  - Define proper TypeScript interfaces for props
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 5.2, 10.3_

- [ ] 4.1 Convert custom constructs - Part 2 (Dependent constructs)
  - Convert lib/constructs/enhanced-load-balancer.ts
  - Convert lib/constructs/load-balancer-zonal-dns-records.ts
  - Convert lib/constructs/operation-log-queries.ts
  - Convert lib/constructs/nested-stack-with-source.ts
  - Ensure all dependencies on Part 1 constructs are properly imported
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 4.2 Convert custom constructs - Part 3 (EKS and Istio)
  - Convert lib/constructs/istio.ts
  - Convert lib/constructs/aws-load-balancer-controller.ts
  - Convert lib/constructs/eks-cluster.ts
  - Convert lib/constructs/eks-application.ts
  - Handle Helm chart references and kubectl layer
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 6.1, 6.2, 6.3_

- [ ] 5. Convert nested stacks - Part 1 (Foundation)
  - Convert lib/nested-stacks/ipv6-network-stack.ts
  - Convert lib/nested-stacks/database-stack.ts
  - Convert lib/nested-stacks/az-tagger-stack.ts
  - Each stack must extend cdk.NestedStack
  - Define proper props interfaces extending NestedStackProps
  - Preserve all CloudFormation outputs
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 6.1, 6.3_

- [ ] 5.1 Convert nested stacks - Part 2 (Compute)
  - Convert lib/nested-stacks/ec2-fleet-stack.ts
  - Convert lib/nested-stacks/eks-stack.ts
  - Handle asset path references for user data scripts
  - Configure auto-scaling groups and launch templates
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 6.2, 6.4_

- [ ] 5.2 Convert nested stacks - Part 3 (Deployment and Monitoring)
  - Convert lib/nested-stacks/code-deploy-application-stack.ts
  - Convert lib/nested-stacks/log-query-stack.ts
  - Convert lib/nested-stacks/application-stack.ts
  - Handle CodeDeploy configuration and alarms
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 5.3 Convert nested stacks - Part 4 (Fault Injection and Health)
  - Convert lib/nested-stacks/fault-injection-stack.ts
  - Convert lib/nested-stacks/ssm-random-fault-stack.ts
  - Convert lib/nested-stacks/route53-health-checks-stack.ts
  - Convert lib/nested-stacks/route53-zonal-dns-stack.ts
  - Reference config files in Configs/ directory
  - _Requirements: 3.1, 3.2, 3.3, 6.5_

- [ ] 5.4 Convert nested stacks - Part 5 (Recovery and Endpoints)
  - Convert lib/nested-stacks/application-recovery-controller-stack.ts
  - Convert lib/nested-stacks/self-managed-http-endpoint-apig-stack.ts
  - Convert lib/nested-stacks/self-managed-http-endpoint-s3-stack.ts
  - Handle conditional stack creation based on evacuation method
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 6. Integrate components in main stack
  - Import all converted constructs and nested stacks
  - Instantiate AvailabilityZoneMapper
  - Create availability zone configuration
  - Instantiate AZTaggerStack
  - Create NetworkStack (IpV6NetworkStack)
  - Create DatabaseStack
  - Create log groups and security groups
  - _Requirements: 1.1, 1.2, 3.3, 10.4_

- [ ] 6.1 Add compute resources to main stack
  - Instantiate EC2FleetStack with proper configuration
  - Instantiate EKSStack with proper configuration
  - Add stack dependencies (AZTaggerStack, log groups)
  - Configure target groups array
  - _Requirements: 1.1, 1.2, 3.3_

- [ ] 6.2 Add load balancer and routing to main stack
  - Create EnhancedApplicationLoadBalancer
  - Enable zonal shift attribute
  - Create Route53ZonalDnsStack (conditional)
  - Add HTTP listener on port 80
  - Create EKS routing rules for /home and /signin paths
  - _Requirements: 1.1, 1.2, 1.5_

- [ ] 6.3 Add observability to main stack
  - Create Service using service factory
  - Instantiate NestedStackWithSource for multi-az-observability
  - Create InstrumentedServiceMultiAZObservability
  - Create BasicServiceMultiAZObservability
  - Configure dashboards and alarms
  - _Requirements: 1.1, 1.2_

- [ ] 6.4 Add fault injection and deployment to main stack
  - Instantiate FaultInjectionStack
  - Instantiate SSMRandomFaultStack
  - Instantiate LogQueryStack
  - Instantiate CodeDeployApplicationStack with alarms
  - Add listener dependency on observability stack
  - Handle evacuation method switch statement
  - _Requirements: 1.1, 1.2, 3.3_

- [ ] 7. Create build scripts for assets
  - Create scripts/build-helm-layer.sh to download Helm and create Lambda layer
  - Create scripts/download-kubectl.sh to download kubectl binary
  - Create scripts/download-helm-charts.sh for Istio and LB controller charts
  - Create scripts/pull-docker-images.sh for container images
  - Create scripts/build-dotnet-app.sh for .NET application
  - Create scripts/build-containers.sh for Docker containers
  - Make all scripts executable
  - _Requirements: 6.1, 6.2, 6.4, 12.1, 12.2_

- [ ] 7.1 Add NPX scripts to package.json
  - Add build:helm-layer script
  - Add build:kubectl script
  - Add build:helm-charts script
  - Add build:docker-images script
  - Add build:dotnet-app script
  - Add build:containers script
  - Add build:assets script to run all build steps
  - Add build:full script for complete build
  - _Requirements: 4.5, 12.1, 12.2, 12.3, 12.4, 12.5_

- [ ] 7.2 Add development and testing NPX scripts
  - Add synth:local script for CDK synthesis
  - Add deploy:local script for CDK deployment
  - Add lint script for ESLint
  - Add lint:fix script for auto-fixing
  - Add test:unit script for Jest tests
  - Add test:coverage script for coverage reports
  - _Requirements: 4.5, 12.1, 12.2, 12.3, 12.4_

- [ ] 8. Verify CloudFormation synthesis
  - Run npm run build to compile TypeScript
  - Run npm run synth:local to synthesize CloudFormation
  - Compare synthesized template with C# version
  - Verify resource counts match
  - Verify parameter names and defaults match
  - Verify output values match
  - Fix any discrepancies
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 8.1 Write unit tests for constructs
  - Create test files for each custom construct
  - Test resource creation and configuration
  - Test prop validation
  - Use CDK assertions library
  - _Requirements: 5.5_

- [ ] 8.2 Write unit tests for nested stacks
  - Create test files for each nested stack
  - Test stack synthesis
  - Test resource properties
  - Test outputs
  - _Requirements: 5.5_

- [ ] 8.3 Write integration tests
  - Test complete stack synthesis
  - Test CloudFormation template validity
  - Create snapshot tests
  - Compare with C# version output
  - _Requirements: 1.1, 5.5_

- [ ] 9. Create comprehensive documentation
  - Write README.md with project overview
  - Document prerequisites (Node.js, AWS CLI, Docker, .NET SDK)
  - Document installation steps
  - Document build process
  - Document deployment process
  - Document testing process
  - Document project structure
  - Add troubleshooting section
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ] 9.1 Create migration documentation
  - Create MIGRATION.md file
  - Document key differences between C# and TypeScript
  - Document naming convention changes
  - Document type system differences
  - Document build process changes
  - Document known issues or limitations
  - _Requirements: 8.4, 8.5_

- [ ] 9.2 Add inline code documentation
  - Add JSDoc comments to all public classes
  - Add JSDoc comments to all public methods
  - Add comments explaining complex logic
  - Add references to C# source where helpful
  - Document TypeScript-specific patterns used
  - _Requirements: 8.3, 8.4_

- [ ] 10. Final validation and cleanup
  - Run full build process (npm run build:full)
  - Run all tests (npm test)
  - Run linter (npm run lint)
  - Synthesize CloudFormation (npm run synth:local)
  - Verify all assets are generated correctly
  - Compare final output with C# version
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 10.1 Remove C# CDK implementation
  - Delete C# source files from cdk/ directory
  - Delete .csproj files
  - Delete C# obj/ and bin/ directories
  - Keep configs/, az-tagger-src/, uploader-src/ directories
  - Keep cdk.json file
  - Update .gitignore for TypeScript artifacts
  - _Requirements: 4.1, 4.2, 4.3_

- [ ] 10.2 Update root-level documentation
  - Update main README.md to reference TypeScript CDK
  - Update any references to C# in documentation
  - Update build instructions in root README
  - Verify all documentation is accurate
  - _Requirements: 8.1, 8.2, 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ] 10.3 Create pull request
  - Commit all changes with clear message
  - Push feature branch to remote
  - Create pull request to main branch
  - Add description of changes
  - Add validation results
  - Request review
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
