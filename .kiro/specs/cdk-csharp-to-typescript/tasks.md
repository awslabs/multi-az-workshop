# Implementation Plan

- [ ] 1. Set up Git branch and project structure
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

- [x] 2. Convert type definitions and enums
  - Create lib/types/evacuation-method.ts with EvacuationMethod enum
  - Convert InstanceArchitecture enum if needed
  - Create lib/types/index.ts to export all types
  - Define interfaces for stack props and construct props
  - _Requirements: 5.1, 5.2, 5.4_

- [x] 2.1 Create CDK app entry point
  - Create bin/multi-az-workshop.ts file
  - Import CDK App class and main stack
  - Instantiate App with proper configuration
  - Create MultiAZWorkshopStack with stack props
  - Configure DefaultStackSynthesizer with bucket naming patterns
  - Call app.synth()
  - _Requirements: 1.1, 1.4, 4.2, 7.4_

- [x] 2.2 Create main stack skeleton
  - Create lib/multi-az-workshop-stack.ts file
  - Define MultiAZWorkshopStackProps interface
  - Create MultiAZWorkshopStack class extending cdk.Stack
  - Add CloudFormation parameters (AssetsBucketName, AssetsBucketPrefix, ParticipantRoleName)
  - Define constants (availabilityZoneNames, fleetSize, domain, etc.)
  - _Requirements: 1.4, 1.5, 2.3, 4.3_

- [x] 3. Convert utility functions
  - Create lib/utils/service-factory.ts file
  - Extract CreateService method from main stack
  - Define CreateServiceOptions interface
  - Convert service creation logic to TypeScript
  - Convert operation definitions (Signin, Pay, Ride, Home)
  - Use proper TypeScript types for all parameters
  - _Requirements: 2.3, 2.4, 5.2, 10.1, 10.3_

- [-] 4. Convert custom constructs - Part 1 (Leaf constructs)
  - Convert lib/constructs/ip-address-type.ts (enum/type)
  - Convert lib/constructs/network-builder.ts
  - Convert lib/constructs/vpc-ipv6-construct.ts
  - Convert lib/constructs/container-and-repo.ts
  - Convert lib/constructs/helm-repo-and-chart.ts
  - Each construct must extend Construct base class
  - Define proper TypeScript interfaces for props
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 5.2, 10.3_

- [x] 4.1 Convert custom constructs - Part 2 (Dependent constructs)
  - Convert lib/constructs/enhanced-load-balancer.ts
  - Convert lib/constructs/load-balancer-zonal-dns-records.ts
  - Convert lib/constructs/operation-log-queries.ts
  - Convert lib/constructs/nested-stack-with-source.ts
  - Ensure all dependencies on Part 1 constructs are properly imported
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 4.2 Convert custom constructs - Part 3 (EKS and Istio)
  - Convert lib/constructs/istio.ts
  - Convert lib/constructs/aws-load-balancer-controller.ts
  - Convert lib/constructs/eks-cluster.ts
  - Convert lib/constructs/eks-application.ts
  - Handle Helm chart references and kubectl layer
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 6.1, 6.2, 6.3_

- [-] 5. Convert nested stacks - Part 1 (Foundation)
  - Convert lib/nested-stacks/ipv6-network-stack.ts
  - Convert lib/nested-stacks/database-stack.ts
  - Convert lib/nested-stacks/az-tagger-stack.ts
  - Each stack must extend cdk.NestedStack
  - Define proper props interfaces extending NestedStackProps
  - Preserve all CloudFormation outputs
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 6.1, 6.3_

- [x] 5.1 Convert nested stacks - Part 2 (Compute)
  - Convert lib/nested-stacks/ec2-fleet-stack.ts
  - Convert lib/nested-stacks/eks-stack.ts
  - Handle asset path references for user data scripts
  - Configure auto-scaling groups and launch templates
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 6.2, 6.4_

- [x] 5.2 Convert nested stacks - Part 3 (Deployment and Monitoring)
  - Convert lib/nested-stacks/code-deploy-application-stack.ts
  - Convert lib/nested-stacks/log-query-stack.ts
  - Convert lib/nested-stacks/application-stack.ts
  - Handle CodeDeploy configuration and alarms
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 5.3 Convert nested stacks - Part 4 (Fault Injection and Health)
  - Convert lib/nested-stacks/fault-injection-stack.ts
  - Convert lib/nested-stacks/ssm-random-fault-stack.ts
  - Convert lib/nested-stacks/route53-health-checks-stack.ts
  - Convert lib/nested-stacks/route53-zonal-dns-stack.ts
  - Reference config files in Configs/ directory
  - _Requirements: 3.1, 3.2, 3.3, 6.5_

- [x] 5.4 Convert nested stacks - Part 5 (Recovery and Endpoints)
  - Convert lib/nested-stacks/application-recovery-controller-stack.ts
  - Convert lib/nested-stacks/self-managed-http-endpoint-apig-stack.ts
  - Convert lib/nested-stacks/self-managed-http-endpoint-s3-stack.ts
  - Handle conditional stack creation based on evacuation method
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 6. Integrate components in main stack
  - Import all converted constructs and nested stacks
  - Instantiate AvailabilityZoneMapper
  - Create availability zone configuration
  - Instantiate AZTaggerStack
  - Create NetworkStack (IpV6NetworkStack)
  - Create DatabaseStack
  - Create log groups and security groups
  - _Requirements: 1.1, 1.2, 3.3, 10.4_

- [x] 6.1 Add compute resources to main stack
  - Instantiate EC2FleetStack with proper configuration
  - Instantiate EKSStack with proper configuration
  - Add stack dependencies (AZTaggerStack, log groups)
  - Configure target groups array
  - _Requirements: 1.1, 1.2, 3.3_

- [x] 6.2 Add load balancer and routing to main stack
  - Create EnhancedApplicationLoadBalancer
  - Enable zonal shift attribute
  - Create Route53ZonalDnsStack (conditional)
  - Add HTTP listener on port 80
  - Create EKS routing rules for /home and /signin paths
  - _Requirements: 1.1, 1.2, 1.5_

- [x] 6.3 Add observability to main stack
  - Create Service using service factory
  - Instantiate NestedStackWithSource for multi-az-observability
  - Create InstrumentedServiceMultiAZObservability
  - Create BasicServiceMultiAZObservability
  - Configure dashboards and alarms
  - _Requirements: 1.1, 1.2_

- [x] 6.4 Add fault injection and deployment to main stack
  - Instantiate FaultInjectionStack
  - Instantiate SSMRandomFaultStack
  - Instantiate LogQueryStack
  - Instantiate CodeDeployApplicationStack with alarms
  - Add listener dependency on observability stack
  - Handle evacuation method switch statement
  - _Requirements: 1.1, 1.2, 3.3_

- [ ] 7. Configure Projen build system
  - Define GitHub workflow in .projenrc.ts that exactly mirrors existing build.yml
  - Load versions from build/versions.json and inject as environment variables
  - Create filter job to check changed files
  - Create build job with all steps from existing workflow
  - Create final job to determine outcome
  - Add local build task that mirrors GitHub workflow (excluding artifact uploads)
  - Update .gitignore to ignore all build artifacts
  - _Requirements: 6.1, 6.2, 6.4, 12.1, 12.2_

- [ ] 7.1 Define GitHub workflow in Projen
  - Read existing .github/workflows/build.yml
  - Create workflow using project.github.addWorkflow("build")
  - Add filter job with file change detection logic
  - Add build job with all environment variables from versions.json
  - Add all build steps: Helm layer, kubectl, charts, images, containers
  - Add final job for outcome determination
  - Ensure generated workflow matches existing build.yml exactly
  - _Requirements: 4.5, 12.1, 12.2, 12.3, 12.4, 12.5_

- [ ] 7.2 Create local build task in Projen
  - Add build:local task using project.addTask()
  - Load versions from build/versions.json as environment variables
  - Add steps to create directories (tmp, assets, cdk/layer/helm)
  - Add step to download Helm and create Lambda layer
  - Add step to copy destination rules from cdk/Configs
  - Add step to download kubectl binary
  - Add step to download Istio Helm charts (base, istiod, gateway, cni)
  - Add step to download AWS LB controller Helm chart
  - Add steps to pull and save Docker images (Istio, LB controller, CloudWatch)
  - Add step to download docker-compose binary
  - Add steps to build .NET containers
  - Add steps to create deployment packages (app_deploy.zip)
  - Add step to synthesize CDK and run package.py
  - Add step to create content.zip with all assets
  - Stop before artifact upload steps (GitHub-only)
  - _Requirements: 4.5, 12.1, 12.2, 12.3, 12.4_

- [ ] 7.3 Add development and testing tasks
  - Add synth:local task for CDK synthesis
  - Add deploy:local task for CDK deployment
  - Add lint:fix task for ESLint auto-fix
  - Add test:unit task for Jest tests
  - Add test:coverage task for coverage reports
  - Ensure all tasks are properly defined in Projen
  - Run npx projen to generate package.json scripts
  - _Requirements: 4.5, 12.1, 12.2, 12.3, 12.4_

- [x] 7.4 Update .gitignore for build artifacts
  - Add assets/ directory to .gitignore
  - Add tmp/ directory to .gitignore
  - Add cdk/layer/ directory to .gitignore
  - Add app-src/output/ directory to .gitignore
  - Add content.zip to .gitignore
  - Add *.tar.gz to .gitignore
  - Ensure cdk/helm-layer.zip is already ignored
  - _Requirements: 4.5, 12.1, 12.2_

- [ ] 8. Verify CloudFormation synthesis
  - Run npx projen build:local to compile TypeScript
  - Compare synthesized template with C# version
  - Verify resource counts match
  - Verify parameter names and defaults match
  - Verify output values match
  - Fix any discrepancies
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 8.1 Write unit tests for constructs
  - Create test files for each custom construct
  - Test resource creation and configuration
  - Test prop validation
  - Use CDK assertions library
  - _Requirements: 5.5_

- [x] 8.2 Write unit tests for nested stacks
  - Create test files for each nested stack
  - Test stack synthesis
  - Test resource properties
  - Test outputs
  - _Requirements: 5.5_

- [x] 8.3 Write integration tests
  - Test complete stack synthesis
  - Test CloudFormation template validity
  - Create snapshot tests
  - Compare with C# version output
  - _Requirements: 1.1, 5.5_

- [x] 9. Create comprehensive documentation
  - Write README.md with project overview
  - Document prerequisites (Node.js, AWS CLI, Docker, .NET SDK)
  - Document installation steps
  - Document build process
  - Document deployment process
  - Document testing process
  - Document project structure
  - Add troubleshooting section
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 9.2 Add inline code documentation
  - Add JSDoc comments to all public classes
  - Add JSDoc comments to all public methods
  - Add comments explaining complex logic
  - Add references to C# source where helpful
  - Document TypeScript-specific patterns used
  - _Requirements: 8.3, 8.4_

- [ ] 10. Implement build workflow in Projen
  - Read the reference build.yml from https://github.com/awslabs/multi-az-workshop/blob/main/.github/workflows/build.yml
  - Create workflow using project.github.addWorkflow("build") in .projenrc.ts
  - Add filter job with file change detection logic (ignore .github/workflows/, .aws/, .kiro/)
  - Add build job with all steps from reference workflow
  - Include environment variables from build/versions.json
  - Add steps for Helm layer, kubectl, charts, images, containers
  - Add steps for .NET container builds
  - Add steps for CDK synthesis and packaging
  - Add final job for outcome determination
  - Ensure workflow matches reference build.yml exactly
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [ ] 11. Implement publish workflow in Projen
  - Create workflow using project.github.addWorkflow("publish") in .projenrc.ts
  - Add workflow_dispatch trigger with inputs (aws credentials, email, prerelease)
  - Add latest_workflow job to find successful build with required artifacts
  - Add assets job to upload AssetsArtifact to S3
  - Add workshop job to push WorkshopArtifact to Workshop Studio
  - Add bump_version_and_release job with semver logic
  - Include version bumping logic (major/minor/patch)
  - Include prerelease handling (alpha, beta, etc.)
  - Create GitHub release with content.zip artifact
  - Ensure workflow matches reference publish.yml exactly
  - _Requirements: 12.1, 12.2_

- [ ] 12. Implement review workflow in Projen
  - Create workflow using project.github.addWorkflow("review") in .projenrc.ts
  - Add pull_request_review trigger (submitted type)
  - Add review job that waits for build workflow completion
  - Check approval status (only hakenmt or github-actions[bot] can approve)
  - Upload BuildDataArtifact with build metadata
  - Fail if build did not succeed or reviewer not authorized
  - Ensure workflow matches reference review.yml exactly
  - _Requirements: 12.1, 12.2_

- [ ] 13. Override auto-approve workflow in Projen
  - Modify the auto-generated auto-approve workflow in .projenrc.ts
  - Add pull_request trigger with types (labeled, opened, synchronize, reopened, ready_for_review)
  - Add approve job that waits for build workflow completion
  - Add step to wait for all required checks to complete (excluding self)
  - Check for auto-approve label and authorized users (hakenmt, github-bot)
  - Use hmarr/auto-approve-action@v2.2.1 for approval
  - Upload BuildDataArtifact with build metadata
  - Fail if build or required checks did not succeed
  - Ensure workflow matches reference auto-approve.yml exactly
  - _Requirements: 12.1, 12.2_

- [ ] 14. Implement test workflow in Projen
  - Create workflow using project.github.addWorkflow("test") in .projenrc.ts
  - Add workflow_run trigger for review and auto-approve workflows
  - Add check_build_status job to verify build completion
  - Add create_deployment job to create GitHub deployment
  - Add deploy_and_cleanup job with AWS CloudFormation deployment
  - Configure AWS credentials using OIDC (id-token: write permission)
  - Upload content to S3 with timestamp prefix
  - Create and execute CloudFormation change set
  - Wait for stack creation/update completion
  - Cleanup old S3 content on success, new content on failure
  - Add finish_deployment job to report deployment status
  - Ensure workflow matches reference test.yml exactly
  - _Requirements: 12.1, 12.2, 12.3_

- [ ] 15. Final validation and cleanup
  - Run full build process (npm run build:full)
  - Run all tests (npm test)
  - Run linter (npm run lint)
  - Synthesize CloudFormation (npm run synth:local)
  - Verify all assets are generated correctly
  - Compare final output with C# version
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 10.1 Remove C# CDK implementation
  - Delete C# source files from cdk/ directory
  - Delete .csproj files
  - Delete C# obj/ and bin/ directories
  - Keep configs/, az-tagger-src/, uploader-src/ directories
  - Keep cdk.json file
  - Update .gitignore for TypeScript artifacts
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 10.2 Update root-level documentation
  - Update main README.md to reference TypeScript CDK
  - Update any references to C# in documentation
  - Update build instructions in root README
  - Verify all documentation is accurate
  - _Requirements: 8.1, 8.2, 9.1, 9.2, 9.3, 9.4, 9.5_

- [-] 10.3 Create pull request
  - Commit all changes with clear message
  - Push feature branch to remote
  - Create pull request to main branch
  - Add description of changes
  - Add validation results
  - Request review
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
