/**
 * Development entry point for the Multi-AZ Workshop CDK application
 * 
 * This file provides a simple development stack for local testing.
 * For production deployment, use bin/multi-az-workshop.ts instead.
 */

import { App, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";

/**
 * Simple development stack for local testing
 */
export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    // define resources here...
  }
}

// for development, use account/region from cdk cli
const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();

new MyStack(app, "multi-az-workshop-cdk-dev", { env: devEnv });
// new MyStack(app, 'multi-az-workshop-cdk-prod', { env: prodEnv });

app.synth();
