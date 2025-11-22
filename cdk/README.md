# Multi-AZ Workshop - TypeScript CDK Implementation

This directory contains the TypeScript AWS CDK implementation of the Multi-AZ Resilience Patterns Workshop. This project demonstrates building, operating, and testing resilient multi-AZ applications on AWS.

## Overview

The Multi-AZ Workshop teaches advanced resilience patterns for building highly available applications across multiple AWS Availability Zones. This CDK application deploys a complete workshop environment including:

- **Multi-AZ VPC** with IPv6 support
- **EKS Cluster** with Istio service mesh
- **EC2 Auto Scaling Group** for compute capacity
- **Aurora PostgreSQL Database** for data persistence
- **Application Load Balancer** with zonal shift capabilities
- **Multi-AZ Observability** with CloudWatch dashboards and alarms
- **Fault Injection** capabilities using AWS FIS
- **CodeDeploy** for zonal deployments
- **Application Recovery Controller (ARC)** for evacuation scenarios

## Prerequisites

Before you begin, ensure you have the following installed:

### Required Software

- **Node.js** (v18 or later)
  - Download from [nodejs.org](https://nodejs.org/)
  - Verify installation: `node --version`

- **AWS CLI** (v2)
  - Installation guide: [AWS CLI Installation](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
  - Verify installation: `aws --version`
  - Configure credentials: `aws configure`

- **AWS CDK CLI** (v2.189.1 or later)
  - Install: `npm install -g aws-cdk`
  - Verify installation: `cdk --version`

- **Docker** (for building container images)
  - Download from [docker.com](https://www.docker.com/get-started)
  - Verify installation: `docker --version`

- **.NET SDK** (v9.0 or later, for building the workshop application)
  - Download from [dotnet.microsoft.com](https://dotnet.microsoft.com/download)
  - Verify installation: `dotnet --version`

### AWS Account Requirements

- An AWS account with appropriate permissions
- AWS credentials configured locally
- Sufficient service quotas for:
  - VPCs and subnets
  - EC2 instances
  - EKS clusters
  - RDS databases
  - Application Load Balancers

## Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/awslabs/multi-az-workshop.git
   cd multi-az-workshop/cdk
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Bootstrap your AWS environment** (if not already done)
   ```bash
   cdk bootstrap aws://ACCOUNT-ID/REGION
   ```

## Project Structure

```
cdk/
├── bin/
│   └── multi-az-workshop.ts          # Application entry point
├── lib/
│   ├── constructs/                   # Reusable CDK constructs
│   │   ├── aws-load-balancer-controller.ts
│   │   ├── container-and-repo.ts
│   │   ├── eks-application.ts
│   │   ├── eks-cluster.ts
│   │   ├── enhanced-load-balancer.ts
│   │   ├── helm-repo-and-chart.ts
│   │   ├── ip-address-type.ts
│   │   ├── istio.ts
│   │   ├── load-balancer-zonal-dns-records.ts
│   │   ├── nested-stack-with-source.ts
│   │   ├── network-builder.ts
│   │   ├── operation-log-queries.ts
│   │   └── vpc-ipv6-construct.ts
│   ├── nested-stacks/                # Nested CloudFormation stacks
│   │   ├── application-recovery-controller-stack.ts
│   │   ├── application-stack.ts
│   │   ├── az-tagger-stack.ts
│   │   ├── code-deploy-application-stack.ts
│   │   ├── database-stack.ts
│   │   ├── ec2-fleet-stack.ts
│   │   ├── eks-stack.ts
│   │   ├── fault-injection-stack.ts
│   │   ├── ipv6-network-stack.ts
│   │   ├── log-query-stack.ts
│   │   ├── route53-health-checks-stack.ts
│   │   ├── route53-zonal-dns-stack.ts
│   │   ├── self-managed-http-endpoint-apig-stack.ts
│   │   ├── self-managed-http-endpoint-s3-stack.ts
│   │   └── ssm-random-fault-stack.ts
│   ├── types/                        # TypeScript type definitions
│   │   ├── common-props.ts
│   │   └── evacuation-method.ts
│   ├── utils/                        # Utility functions
│   │   └── service-factory.ts
│   └── multi-az-workshop-stack.ts    # Main stack definition
├── test/                             # Test files
│   └── main.test.ts
├── .projenrc.ts                      # Projen configuration
├── cdk.json                          # CDK configuration
├── package.json                      # Node.js dependencies
├── tsconfig.json                     # TypeScript configuration
└── README.md                         # This file
```

## Build Process

The project uses Projen for project management and includes several build targets:

### Development Build

```bash
# Compile TypeScript to JavaScript
npm run compile

# Run linting
npm run eslint

# Run tests
npm run test

# Full build (compile + test)
npm run build
```

### CDK-Specific Commands

```bash
# Synthesize CloudFormation template
npm run cdk:synth

# View differences between deployed stack and current code
cdk diff

# Deploy the stack
npm run cdk:deploy

# Destroy the stack
cdk destroy
```

## Deployment Process

### Standard Deployment

1. **Synthesize the CloudFormation template**
   ```bash
   npm run cdk:synth
   ```

2. **Review the changes**
   ```bash
   cdk diff
   ```

3. **Deploy the stack**
   ```bash
   npm run cdk:deploy
   ```

   Or with parameters:
   ```bash
   cdk deploy \
     --parameters AssetsBucketName=my-assets-bucket \
     --parameters AssetsBucketPrefix=workshop/ \
     --parameters ParticipantRoleName=Admin
   ```

### Workshop Deployment

For workshop environments, the stack expects three CloudFormation parameters:

- **AssetsBucketName**: S3 bucket containing workshop assets
- **AssetsBucketPrefix**: Prefix within the bucket for assets
- **ParticipantRoleName**: IAM role name for workshop participants

Example:
```bash
aws cloudformation create-stack \
  --stack-name multi-az-workshop \
  --template-body file://cdk.out/multi-az-workshop.template.json \
  --parameters \
    ParameterKey=AssetsBucketName,ParameterValue=workshop-assets \
    ParameterKey=AssetsBucketPrefix,ParameterValue=v1.0/ \
    ParameterKey=ParticipantRoleName,ParameterValue=WorkshopAdmin \
  --capabilities CAPABILITY_IAM
```

## Testing Process

### Unit Tests

Run Jest unit tests:
```bash
npm run test
```

Run tests in watch mode:
```bash
npm run test:watch
```

### Integration Tests

The project includes integration tests that validate the deployed infrastructure:

1. Deploy the stack to a test environment
2. Run integration tests against the deployed resources
3. Clean up test resources

### Test Coverage

View test coverage report:
```bash
npm run test
# Coverage report is generated in ./coverage/
```

## Configuration

### CDK Context

The `cdk.json` file contains CDK configuration:

```json
{
  "app": "npx ts-node --prefer-ts-exts bin/multi-az-workshop.ts",
  "context": {
    "@aws-cdk/core:newStyleStackSynthesis": true
  }
}
```

### Environment Variables

The following environment variables can be used:

- `CDK_DEFAULT_ACCOUNT`: AWS account ID for deployment
- `CDK_DEFAULT_REGION`: AWS region for deployment
- `AWS_PROFILE`: AWS CLI profile to use

### Stack Parameters

The main stack accepts these parameters:

- **AssetsBucketName** (required): S3 bucket for workshop assets
- **AssetsBucketPrefix** (required): Prefix for assets in the bucket
- **ParticipantRoleName** (optional): IAM role for workshop participants

## Architecture

### Network Architecture

- **VPC**: Multi-AZ VPC with IPv6 support
- **Subnets**: Public, private with egress, and isolated subnets across 3 AZs
- **Load Balancer**: Application Load Balancer with zonal shift enabled

### Compute Architecture

- **EKS Cluster**: Kubernetes cluster with managed node groups
- **EC2 Fleet**: Auto Scaling Group for additional compute capacity
- **Istio Service Mesh**: Traffic management and observability

### Data Architecture

- **Aurora PostgreSQL**: Multi-AZ database cluster
- **Secrets Manager**: Database credentials management

### Observability

- **CloudWatch Dashboards**: Multi-AZ metrics and alarms
- **Contributor Insights**: Per-AZ performance analysis
- **Log Insights**: Query definitions for troubleshooting
- **Canary Tests**: Synthetic monitoring with Lambda

### Resilience Features

- **Zonal Shift**: ALB zonal shift for AZ evacuation
- **Fault Injection**: AWS FIS experiments for chaos engineering
- **CodeDeploy**: Zonal deployment strategies
- **ARC**: Application Recovery Controller for evacuation

## Troubleshooting

### Common Issues

#### 1. CDK Bootstrap Required

**Error**: `Policy contains a statement with one or more invalid principals`

**Solution**: Bootstrap your AWS environment:
```bash
cdk bootstrap aws://ACCOUNT-ID/REGION
```

#### 2. Insufficient Permissions

**Error**: `User is not authorized to perform: iam:CreateRole`

**Solution**: Ensure your AWS credentials have sufficient permissions. The deployment requires:
- IAM role creation
- VPC and networking resources
- EKS cluster management
- RDS database creation
- CloudFormation stack operations

#### 3. Service Quota Exceeded

**Error**: `LimitExceededException: Cannot create more than X`

**Solution**: Request a service quota increase in the AWS Service Quotas console.

#### 4. Docker Not Running

**Error**: `Cannot connect to the Docker daemon`

**Solution**: Start Docker Desktop or the Docker daemon:
```bash
# macOS/Windows
# Start Docker Desktop application

# Linux
sudo systemctl start docker
```

#### 5. Node Modules Issues

**Error**: `Cannot find module` or dependency errors

**Solution**: Clean and reinstall dependencies:
```bash
rm -rf node_modules package-lock.json
npm install
```

#### 6. TypeScript Compilation Errors

**Error**: Type errors during compilation

**Solution**: Ensure you're using the correct TypeScript version:
```bash
npm install
npm run compile
```

#### 7. CDK Version Mismatch

**Error**: `Cloud assembly schema version mismatch`

**Solution**: Ensure CDK CLI version matches the project:
```bash
npm install -g aws-cdk@2.189.1
```

### Getting Help

- **Workshop Documentation**: [Workshop Studio](https://catalog.workshops.aws/multi-az-gray-failures)
- **AWS CDK Documentation**: [CDK Developer Guide](https://docs.aws.amazon.com/cdk/)
- **GitHub Issues**: [Report issues](https://github.com/awslabs/multi-az-workshop/issues)

### Debug Mode

Enable verbose logging:
```bash
cdk deploy --verbose
```

View CloudFormation events:
```bash
aws cloudformation describe-stack-events --stack-name multi-az-workshop
```

## Key Differences from C# Implementation

This TypeScript implementation maintains feature parity with the original C# version while leveraging TypeScript-specific patterns:

### Language Features

- **Type Safety**: TypeScript interfaces and types for compile-time checking
- **Async/Await**: Native promise handling instead of Task-based async
- **Module System**: ES6 imports/exports instead of C# namespaces
- **Null Safety**: Optional chaining (`?.`) and nullish coalescing (`??`)

### CDK Patterns

- **Construct Initialization**: Constructor-based instead of property initialization
- **Resource References**: Direct property access instead of getter methods
- **Custom Resources**: Lambda-backed custom resources using Node.js runtime
- **Aspects**: CDK Aspects for cross-cutting concerns

### Build System

- **Package Manager**: npm/yarn instead of NuGet
- **Build Tool**: Projen for project management
- **Testing**: Jest instead of xUnit
- **Linting**: ESLint instead of StyleCop

### Naming Conventions

- **camelCase**: For variables and functions (TypeScript convention)
- **PascalCase**: For classes and interfaces (maintained from C#)
- **kebab-case**: For file names (TypeScript convention)

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the Apache-2.0 License. See [LICENSE](LICENSE) for details.

## Additional Resources

- [Workshop Content](https://catalog.workshops.aws/multi-az-gray-failures)
- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
- [Multi-AZ Observability Library](https://github.com/cdklabs/multi-az-observability)
- [AWS CDK Examples](https://github.com/aws-samples/aws-cdk-examples)
