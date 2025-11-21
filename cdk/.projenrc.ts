import { awscdk } from 'projen';

const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: '2.189.1',
  defaultReleaseBranch: 'main',
  name: 'multi-az-workshop-cdk',
  projenrcTs: true,

  // Dependencies
  deps: [
    '@cdklabs/multi-az-observability@0.0.1-alpha.60',
    '@aws-cdk/lambda-layer-kubectl-v31@^2.0.0',
  ],

  // Dev dependencies
  devDeps: [
    '@types/node',
  ],

  // TypeScript configuration
  tsconfig: {
    compilerOptions: {
      target: 'ES2020',
      module: 'commonjs',
      lib: ['ES2020'],
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
    },
  },

  // ESLint configuration
  eslint: true,
  prettier: true,

  // Jest configuration
  jest: true,
  jestOptions: {
    jestConfig: {
      testMatch: ['**/*.test.ts'],
      coverageDirectory: 'coverage',
    },
  },

  // GitHub workflows
  buildWorkflow: true,
  release: false,

  // CDK-specific
  cdkout: 'cdk.out',
  context: {
    '@aws-cdk/core:newStyleStackSynthesis': true,
  },

  // Custom scripts
  scripts: {
    'build:helm-layer': 'scripts/build-helm-layer.sh',
    'build:kubectl': 'scripts/download-kubectl.sh',
    'build:helm-charts': 'scripts/download-helm-charts.sh',
    'build:docker-images': 'scripts/pull-docker-images.sh',
    'build:dotnet-app': 'scripts/build-dotnet-app.sh',
    'build:containers': 'scripts/build-containers.sh',
    'build:assets': 'npm run build:helm-layer && npm run build:kubectl && npm run build:helm-charts && npm run build:docker-images && npm run build:dotnet-app && npm run build:containers',
    'build:full': 'npm run build && npm run build:assets',
    'lint:fix': 'eslint . --ext .ts --fix',
    'test:unit': 'jest --coverage',
    'synth:local': 'cdk synth',
    'deploy:local': 'cdk deploy',
  },
});

project.synth();
