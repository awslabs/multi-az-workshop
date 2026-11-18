// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { chartDigest } from '../../src/cdk/build-assets';

// The shape helm writes an index.yaml in: one `  - ` item per chart version, each with its digest
// and its urls (absolute, as blob.istio.io's, or relative to the index).
const INDEX = `apiVersion: v1
entries:
  base:
  - apiVersion: v2
    created: "2026-11-09T18:58:07Z"
    description: Helm chart for deploying Istio cluster resources
    digest: ${'a'.repeat(64)}
    keywords:
    - istio
    name: base
    urls:
    - https://blob.istio.io/istio-release/charts/base-1.32.0.tgz
    version: 1.32.0
  - apiVersion: v2
    digest: ${'b'.repeat(64)}
    name: base
    urls:
    - https://blob.istio.io/istio-release/charts/base-1.31.0.tgz
    version: 1.31.0
  aws-load-balancer-controller:
  - apiVersion: v2
    digest: "${'c'.repeat(64)}"
    name: aws-load-balancer-controller
    urls:
    - aws-load-balancer-controller-3.6.3.tgz
    version: 3.6.3
generated: "2026-11-13T01:41:30Z"
`;

describe('chartDigest', () => {
  test("the digest of the item whose urls name the file, an absolute url's", () => {
    expect(chartDigest(INDEX, 'repo', 'base-1.32.0.tgz')).toBe('a'.repeat(64));
    expect(chartDigest(INDEX, 'repo', 'base-1.31.0.tgz')).toBe('b'.repeat(64));
  });

  test("a relative url's, digest quoted", () => {
    expect(chartDigest(INDEX, 'repo', 'aws-load-balancer-controller-3.6.3.tgz')).toBe('c'.repeat(64));
  });

  test('a file no item names, or a suffix of another, is refused', () => {
    expect(() => chartDigest(INDEX, 'repo', 'base-1.30.0.tgz')).toThrow('0 digests for base-1.30.0.tgz');
    expect(() => chartDigest(INDEX, 'repo', 'se-1.32.0.tgz')).toThrow('0 digests');
  });
});
