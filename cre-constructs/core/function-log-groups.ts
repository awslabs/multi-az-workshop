import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { IConstruct } from 'constructs';

/** How long a function's log group (see {@link FunctionLogGroups}) keeps its events. */
export const FUNCTION_LOG_RETENTION = logs.RetentionDays.ONE_MONTH;

/**
 * Gives every Lambda function in the app a log group its stack owns, so a teardown deletes it:
 * without one, Lambda creates `/aws/lambda/<function>` itself, outside CloudFormation, and it outlives
 * the stack (a deploy-and-teardown leaves the kubectl provider's behind every run).
 *
 * Each function without a log group of its own gets one, with a name CloudFormation picks (so it
 * never collides with a group a construct names `/aws/lambda/<function>`), deleted with the stack,
 * kept {@link FUNCTION_LOG_RETENTION}, and set as the function's `LoggingConfig.LogGroup`. Left as
 * they are: a function whose `LoggingConfig` names a log group (its `logGroup` prop), and one whose
 * `/aws/lambda/<function>` group the stack makes itself (a construct that sets its retention or
 * filters it). Covers `lambda.Function`s and the raw `AWS::Lambda::Function`s of CDK's own custom
 * resource providers alike. CreApp adds it to every app.
 */
export class FunctionLogGroups implements cdk.IAspect {
  public visit(node: IConstruct): void {
    if (!(node instanceof cdk.CfnResource) || node.cfnResourceType !== 'AWS::Lambda::Function') return;
    const stack = cdk.Stack.of(node);
    if (hasLogGroup(stack, node) || namedForIt(stack, node)) return;
    const group = new logs.LogGroup(node.node.scope ?? stack, `${node.node.id}CreLogs`, {
      retention: FUNCTION_LOG_RETENTION,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    if (node instanceof lambda.CfnFunction) {
      node.loggingConfig = { ...(stack.resolve(node.loggingConfig) ?? {}), logGroup: group.logGroupName };
    } else {
      node.addPropertyOverride('LoggingConfig.LogGroup', group.logGroupName);
    }
  }
}

/** A `lambda.Function`'s LoggingConfig names a log group already (its `logGroup` prop). CDK's own raw
 * provider functions never set one. */
function hasLogGroup(stack: cdk.Stack, fn: cdk.CfnResource): boolean {
  return fn instanceof lambda.CfnFunction && Boolean(stack.resolve(fn.loggingConfig)?.logGroup);
}

/** The stack makes a log group whose name refers to this function (`/aws/lambda/<function>`). */
function namedForIt(stack: cdk.Stack, fn: cdk.CfnResource): boolean {
  const ref = JSON.stringify({ Ref: stack.resolve(fn.logicalId) });
  return stack.node.findAll().some((c) => c instanceof logs.CfnLogGroup && cdk.Stack.of(c) === stack
    && JSON.stringify(stack.resolve(c.logGroupName) ?? '').includes(ref));
}
