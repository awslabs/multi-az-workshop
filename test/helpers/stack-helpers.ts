/**
 * Stack helper functions for synthesis and resource inspection
 * Provides utilities for working with CDK stacks in tests
 */

import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';

/**
 * Synthesizes a stack and returns the CloudFormation template
 */
export function synthesizeStack(stack: cdk.Stack): Template {
  return Template.fromStack(stack);
}

/**
 * Gets the count of resources of a specific type in a template
 */
export function getResourceCount(
  template: Template,
  resourceType: string,
): number {
  const resources = findResourcesByType(template, resourceType);
  return resources.length;
}

/**
 * Finds all resources of a specific type in a template
 */
export function findResourcesByType(
  template: Template,
  resourceType: string,
): any[] {
  const templateJson = template.toJSON();
  const resources = templateJson.Resources || {};

  return Object.entries(resources)
    .filter(([_, resource]: [string, any]) => resource.Type === resourceType)
    .map(([logicalId, resource]: [string, any]) => ({
      logicalId,
      ...resource,
    }));
}

/**
 * Finds a single resource of a specific type (throws if not exactly one)
 */
export function findResourceByType(
  template: Template,
  resourceType: string,
): any {
  const resources = findResourcesByType(template, resourceType);

  if (resources.length === 0) {
    throw new Error(`No resources of type ${resourceType} found`);
  }

  if (resources.length > 1) {
    throw new Error(
      `Expected exactly one resource of type ${resourceType}, found ${resources.length}`,
    );
  }

  return resources[0];
}

/**
 * Gets all resource types present in a template
 */
export function getResourceTypes(template: Template): string[] {
  const templateJson = template.toJSON();
  const resources = templateJson.Resources || {};

  const types = new Set<string>();
  Object.values(resources).forEach((resource: any) => {
    types.add(resource.Type);
  });

  return Array.from(types).sort();
}

/**
 * Gets all outputs from a template
 */
export function getOutputs(template: Template): Record<string, any> {
  const templateJson = template.toJSON();
  return templateJson.Outputs || {};
}

/**
 * Gets all parameters from a template
 */
export function getParameters(template: Template): Record<string, any> {
  const templateJson = template.toJSON();
  return templateJson.Parameters || {};
}

/**
 * Checks if a resource with specific properties exists
 */
export function hasResourceWithProperties(
  template: Template,
  resourceType: string,
  properties: any,
): boolean {
  try {
    template.hasResourceProperties(resourceType, properties);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets the properties of a specific resource by logical ID
 */
export function getResourceProperties(
  template: Template,
  logicalId: string,
): any {
  const templateJson = template.toJSON();
  const resources = templateJson.Resources || {};

  if (!resources[logicalId]) {
    throw new Error(`Resource with logical ID ${logicalId} not found`);
  }

  return resources[logicalId].Properties || {};
}

/**
 * Gets all resources with their logical IDs
 */
export function getAllResources(template: Template): Record<string, any> {
  const templateJson = template.toJSON();
  return templateJson.Resources || {};
}

/**
 * Checks if a template has a specific output
 */
export function hasOutput(template: Template, outputName: string): boolean {
  const outputs = getOutputs(template);
  return outputName in outputs;
}

/**
 * Checks if a template has a specific parameter
 */
export function hasParameter(template: Template, parameterName: string): boolean {
  const parameters = getParameters(template);
  return parameterName in parameters;
}

/**
 * Gets the value of a specific output
 */
export function getOutputValue(template: Template, outputName: string): any {
  const outputs = getOutputs(template);

  if (!outputs[outputName]) {
    throw new Error(`Output ${outputName} not found`);
  }

  return outputs[outputName].Value;
}

/**
 * Gets the value of a specific parameter
 */
export function getParameterValue(template: Template, parameterName: string): any {
  const parameters = getParameters(template);

  if (!parameters[parameterName]) {
    throw new Error(`Parameter ${parameterName} not found`);
  }

  return parameters[parameterName];
}

/**
 * Counts resources matching a specific property pattern
 */
export function countResourcesWithProperties(
  template: Template,
  resourceType: string,
  properties: any,
): number {
  const resources = findResourcesByType(template, resourceType);

  return resources.filter((resource) => {
    try {
      const resourceProps = resource.Properties || {};
      return Match.objectLike(properties).test(resourceProps).isSuccess;
    } catch {
      return false;
    }
  }).length;
}

