// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Assertion helper functions for common test patterns
 * Provides reusable assertions with clear error messages
 */

import { Template } from 'aws-cdk-lib/assertions';
import {
  getResourceCount,
  hasParameter,
  getParameters,
} from './stack-helpers';

/**
 * Asserts that a resource of a specific type exists in the template
 */
export function assertResourceExists(
  template: Template,
  resourceType: string,
  count?: number,
): void {
  const actualCount = getResourceCount(template, resourceType);

  if (count !== undefined) {
    expect(actualCount).toBe(count);
  } else {
    expect(actualCount).toBeGreaterThan(0);
  }
}

/**
 * Asserts that a resource with specific properties exists
 */
export function assertResourceProperties(
  template: Template,
  resourceType: string,
  properties: any,
  customMessage?: string,
): void {
  try {
    template.hasResourceProperties(resourceType, properties);
  } catch (error) {
    const message =
      customMessage ||
      `Failed to find ${resourceType} with expected properties`;
    throw new Error(
      `${message}\nOriginal error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Asserts that a parameter exists in the template
 */
export function assertParameterExists(
  template: Template,
  parameterName: string,
  customMessage?: string,
): void {
  const exists = hasParameter(template, parameterName);
  const message = customMessage || `Parameter ${parameterName} should exist`;

  expect(exists).toBe(true);

  if (!exists) {
    const parameters = getParameters(template);
    const availableParameters = Object.keys(parameters).join(', ');
    throw new Error(
      `${message}\nAvailable parameters: ${availableParameters || 'none'}`,
    );
  }
}

/**
 * Asserts that a resource does not exist in the template
 */
export function assertResourceDoesNotExist(
  template: Template,
  resourceType: string,
): void {
  const count = getResourceCount(template, resourceType);
  expect(count).toBe(0);
}

/**
 * Asserts that exactly N resources of a type exist
 */
export function assertResourceCount(
  template: Template,
  resourceType: string,
  expectedCount: number,
): void {
  const actualCount = getResourceCount(template, resourceType);
  expect(actualCount).toBe(expectedCount);
}

/** One artifact CreEcrImport loads, as its custom resource lists it (a token in it reads 'TOKEN'). */
export interface EcrImportArtifact {
  readonly kind: 'image' | 'helm';
  readonly repository: string;
  readonly tag: string;
}

/**
 * The template's one CreEcrImport resource (its logical id) and the artifacts its `Artifacts`
 * property lists. The list is JSON with tokens in it (the buckets, keys and repository names), which
 * CloudFormation joins: each token becomes 'TOKEN'.
 */
export function ecrImportArtifacts(template: Template): { id: string; artifacts: EcrImportArtifact[] } {
  const imports = Object.entries(template.findResources('Custom::CreEcrImport'));
  expect(imports).toHaveLength(1);
  const [id, resource] = imports[0] as [string, any];
  const value = resource.Properties.Artifacts;
  const text = typeof value === 'string'
    ? value
    : (value['Fn::Join'][1] as unknown[]).map((p) => (typeof p === 'string' ? p : 'TOKEN')).join('');
  return { id, artifacts: JSON.parse(text) };
}
