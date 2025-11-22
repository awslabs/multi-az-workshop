/**
 * Test suite for the Multi-AZ Workshop CDK application
 * 
 * This file contains snapshot tests to ensure the CDK stack
 * generates consistent CloudFormation templates.
 */

import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { MyStack } from "../src/main";

/**
 * Snapshot test to verify CloudFormation template consistency
 */
test("Snapshot", () => {
  const app = new App();
  const stack = new MyStack(app, "test");

  const template = Template.fromStack(stack);
  expect(template.toJSON()).toMatchSnapshot();
});
