// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { NodePackageManager, NodeProject } from 'projen/lib/javascript';
import { Testing } from 'projen/lib/testing';
import { approveOncePerLabel } from './auto-approve-workflow';

const TRUSTED = ['alice', 'robot[bot]'];

function approveIf(project: NodeProject): string {
  const workflow: string = Testing.synth(project)['.github/workflows/auto-approve.yml'];
  const line = workflow.split('\n').find((l) => l.trimStart().startsWith('if: '));
  if (!line) throw new Error('approve job has no if');
  return line.trimStart().slice('if: '.length);
}

function newProject(autoApprove = true): NodeProject {
  return new NodeProject({
    name: 'test',
    defaultReleaseBranch: 'main',
    packageManager: NodePackageManager.YARN_BERRY,
    github: true,
    autoApproveOptions: autoApprove ? { allowedUsernames: TRUSTED, label: 'auto-approve' } : undefined,
  });
}

/**
 * Evaluates the generated `if` for one event. GitHub expressions here use
 * only `contains`, `==`, `!=`, `&&`, `||` and parentheses, so they map onto
 * JavaScript once `contains(...)` and the event fields are replaced.
 */
function approves(cond: string, event: { action: string; label?: string; labels: string[]; author: string; sender: string }): boolean {
  const js = cond
    .replace("contains(github.event.pull_request.labels.*.name, 'auto-approve')", String(event.labels.includes('auto-approve')))
    .replace(/github\.event\.action/g, JSON.stringify(event.action))
    .replace(/github\.event\.label\.name/g, JSON.stringify(event.label ?? ''))
    .replace(/github\.event\.pull_request\.user\.login/g, JSON.stringify(event.author))
    .replace(/github\.event\.sender\.login/g, JSON.stringify(event.sender))
    .replace(/'([^']*)'/g, (_m, s) => JSON.stringify(s));
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`return (${js});`)() as boolean;
}

describe('approveOncePerLabel', () => {
  const both = ['auto-approve', 'auto-merge'];

  test('a PR opened without labels and then given both is approved exactly once', () => {
    const project = newProject();
    approveOncePerLabel(project, TRUSTED);
    const cond = approveIf(project);

    const events = [
      { action: 'opened', labels: [], author: 'alice', sender: 'alice' },
      { action: 'labeled', label: 'auto-approve', labels: both, author: 'alice', sender: 'alice' },
      { action: 'labeled', label: 'auto-merge', labels: both, author: 'alice', sender: 'alice' },
    ];
    expect(events.filter((e) => approves(cond, e))).toHaveLength(1);
  });

  test('adding a label other than auto-approve never approves', () => {
    const project = newProject();
    approveOncePerLabel(project, TRUSTED);
    expect(approves(approveIf(project), { action: 'labeled', label: 'auto-merge', labels: both, author: 'alice', sender: 'alice' })).toBe(false);
  });

  test('a new commit from a trusted pusher is approved', () => {
    const project = newProject();
    approveOncePerLabel(project, TRUSTED);
    expect(approves(approveIf(project), { action: 'synchronize', labels: both, author: 'alice', sender: 'alice' })).toBe(true);
  });

  test('a commit an untrusted person pushes onto a trusted PR is not approved', () => {
    const project = newProject();
    approveOncePerLabel(project, TRUSTED);
    expect(approves(approveIf(project), { action: 'synchronize', labels: both, author: 'alice', sender: 'mallory' })).toBe(false);
  });

  test('an untrusted author is never approved', () => {
    const project = newProject();
    approveOncePerLabel(project, TRUSTED);
    expect(approves(approveIf(project), { action: 'labeled', label: 'auto-approve', labels: both, author: 'mallory', sender: 'alice' })).toBe(false);
  });

  test('without the auto-approve label nothing is approved', () => {
    const project = newProject();
    approveOncePerLabel(project, TRUSTED);
    expect(approves(approveIf(project), { action: 'opened', labels: ['auto-merge'], author: 'alice', sender: 'alice' })).toBe(false);
  });

  test('fails loudly when auto-approve is not enabled', () => {
    expect(() => approveOncePerLabel(newProject(false), TRUSTED)).toThrow(/auto-approve workflow not found/);
  });

  test('rejects an empty trusted list', () => {
    expect(() => approveOncePerLabel(newProject(), [])).toThrow(/at least one trusted username/);
  });
});
