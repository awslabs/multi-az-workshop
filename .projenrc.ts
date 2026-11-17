import { CreModule, CreWorkshopStudio, WorkshopAccountSource } from './projenrc/cre/src';
import { addTransitiveDependencyUpgrade, createBuildTasks } from './projenrc/tasks';

// Everything the template pins (toolchain, tsconfig/eslint, the GitHub workflows, build, deploy,
// teardown, publish and git tasks, steering) lives in the project type, vendored at projenrc/cre/.
// This file holds the workshop's own choices. To pick up template fixes: npx projen update-template.
const project = new CreWorkshopStudio({
  name: 'multi-az-workshop',
  description: 'The multi-AZ resilience patterns workshop',
  repository: 'https://github.com/awslabs/multi-az-workshop',
  github: { username: 'hakenmt', appSlug: 'aws-cre-automation-mhaken', visibility: 'public' },
  // The stacks come from the CDK app (src/cdk/app.ts): every top-level stack is a CreStack with its
  // region, and every parameter the pipeline passes is a CreCfnParameter. Guide: cre-pipelines.md.
  constructModules: [CreModule.ECR_IMPORT],
  // Delete the stacks again after each deploy from main that succeeded: nothing stays up to age into security findings.
  teardownAfterDeploy: true,
  // The build runs the .NET build and tests: dotnet before the PR build and the deploy's build job.
  buildSetup: {
    github: [{
      name: 'Install dotnet',
      uses: 'actions/setup-dotnet@0f4a354dd5547a28c70b7853dbd95d5b67886e73', // v6.1.0 (node24)
      with: { 'dotnet-version': '9.0' },
    }],
  },
  devDeps: [
    '@cdklabs/multi-az-observability@0.0.1-alpha.60',
    '@aws-cdk/lambda-layer-kubectl-v35@^2.0.0',
    'fast-check@^3.15.0',
  ],
  additionalGitignore: [
    // Local-only facilitator notes (not part of the published workshop)
    'FACILITATOR_GUIDE.md',
    // .NET build and test output
    'src/app/bin',
    'src/app/obj',
    'src/app/output/',
    'test/app/bin',
    'test/app/TestResults',
    'test/app/obj',
  ],
  // contentspec.yaml, generated from these and the stacks.
  workshopStudio: {
    locales: ['en-US'],
    accountSources: [WorkshopAccountSource.WORKSHOP_STUDIO, WorkshopAccountSource.CUSTOMER_PROVIDED],
    deployableRegions: { recommended: ['us-east-1', 'us-east-2', 'us-west-2', 'eu-west-1', 'ap-southeast-1', 'ap-southeast-2'] },
    minAccessibleRegions: 1,
    maxAccessibleRegions: 1,
    participantPolicies: ['static/iam_policy.json'],
    serviceLinkedRoles: ['fis.amazonaws.com', 'eks.amazonaws.com', 'autoscaling.amazonaws.com'],
    additionalLinks: [
      {
        title: 'Advanced Multi-AZ Resilience Patterns Whitepaper',
        link: 'https://docs.aws.amazon.com/whitepapers/latest/advanced-multi-az-resilience-patterns/advanced-multi-az-resilience-patterns.html',
      },
      {
        title: 'Fault-isolated, zonal deployments with AWS CodeDeploy',
        link: 'https://aws.amazon.com/blogs/devops/fault-isolated-zonal-deployments-with-aws-codedeploy/',
      },
      {
        title: 'Detecting gray failures with outlier detection in Amazon CloudWatch Contributor Insights',
        link: 'https://aws.amazon.com/blogs/mt/detecting-gray-failures-with-outlier-detection-in-amazon-cloudwatch-contributor-insights/',
      },
      {
        title: 'Rapidly recover from application failures in a single AZ',
        link: 'https://aws.amazon.com/blogs/networking-and-content-delivery/rapidly-recover-from-application-failures-in-a-single-az/',
      },
      {
        title: 'Zonal autoshift - Automatically shift your traffic away from Availability Zones when we detect potential issues',
        link: 'https://aws.amazon.com/blogs/aws/zonal-autoshift-automatically-shift-your-traffic-away-from-availability-zones-when-we-detect-potential-issues/',
      },
      {
        title: 'Using zonal shift with Amazon EC2 Auto Scaling',
        link: 'https://aws.amazon.com/blogs/compute/using-zonal-shift-with-amazon-ec2-auto-scaling/',
      },
      {
        title: 'Using cross-zone load balancing with zonal shift',
        link: 'https://aws.amazon.com/blogs/networking-and-content-delivery/using-cross-zone-load-balancing-with-zonal-shift/',
      },
      {
        title: 'Multi-AZ Observability CDK Construct',
        link: 'https://github.com/bamcis-io/multi-az-observability/',
      },
      {
        title: 'Improving availability with Application Load Balancer automatic target weights',
        link: 'https://aws.amazon.com/blogs/networking-and-content-delivery/improving-availability-with-application-load-balancer-automatic-target-weights/',
      },
      {
        title: 'Monitoring and automating recovery from AZ impairments in Amazon EKS with Istio and ARC Zonal Shift',
        link: 'https://aws.amazon.com/blogs/containers/monitoring-and-automating-recovery-from-az-impairments-in-amazon-eks-with-istio-and-arc-zonal-shift/',
      },
    ],
  },
});

// Stricter floors than the project type's for these two (security patches).
project.package.addPackageResolutions('fast-uri@>=4.1.5', 'handlebars@>=4.7.10');

// The .NET app, its tests, and the assets the stack and the guide use (container images, Helm
// charts, kubectl, docker compose, the CodeDeploy bundles), in the build's lifecycle.
createBuildTasks(project);
addTransitiveDependencyUpgrade(project);

project.synth();
