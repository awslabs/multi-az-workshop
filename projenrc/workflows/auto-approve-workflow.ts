// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { NodeProject } from 'projen/lib/javascript';

/**
 * Makes projen's auto-approve approve a PR once instead of once per event.
 *
 * projen's auto-approve runs on every `opened` and `labeled` event while the PR
 * has the label, so a PR opened with both `auto-approve` and `auto-merge` got
 * three runs and three approvals (three review emails). This approves on
 * `opened`, `reopened` and `ready_for_review` (labels already there), on adding
 * the `auto-approve` label itself, and on a new commit (`synchronize`), but
 * never on adding another label. Together with opening PRs without labels and
 * then adding both, each PR is approved exactly once.
 *
 * The event's sender must be trusted too: on `synchronize` that is whoever
 * pushed, so a commit an untrusted person pushes onto a trusted author's PR is
 * never approved for them.
 */
export function approveOncePerLabel(project: NodeProject, trustedUsernames: string[]): void {
  const file = project.github?.tryFindWorkflow('auto-approve')?.file;
  if (!file) {
    throw new Error('auto-approve workflow not found; is autoApprove enabled?');
  }
  if (trustedUsernames.length === 0) {
    throw new Error('approveOncePerLabel needs at least one trusted username');
  }

  const authors = trustedUsernames.map((u) => `github.event.pull_request.user.login == '${u}'`).join(' || ');
  const senders = trustedUsernames.map((u) => `github.event.sender.login == '${u}'`).join(' || ');
  file.addOverride(
    'jobs.approve.if',
    "contains(github.event.pull_request.labels.*.name, 'auto-approve') && " +
      "(github.event.action != 'labeled' || github.event.label.name == 'auto-approve') && " +
      `(${authors}) && (${senders})`,
  );
}
