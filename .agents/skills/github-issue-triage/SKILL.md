---
name: github-issue-triage
description: Triage GitHub Issues and reconcile label definitions using the repository's report-first, no-delete workflow.
---

# GitHub Issue Triage

## Owners

- [backlog-execution.md](../../rules/backlog-execution.md) owns the rule that one issue, accepted
  specification, or direct request is the authoritative work record.
- [`.github/labels.json`](../../../.github/labels.json) owns exact label names, descriptions, colors,
  applicability, and declared producers and consumers.
- [issue-to-backlog](../issue-to-backlog/SKILL.md) owns the exceptional decision to create one
  repository Task when the issue alone cannot carry durable coordination.

This skill owns issue intake, label reconciliation, and read-only reporting. It does not require a Task,
paired spec, status-file move, or conversion receipt before implementation.

## Intake

Use the matching Issue Form whenever possible. A new issue starts with exactly one work-kind label
(`bug`, `enhancement`, or `documentation`) and `status:needs-triage`; do not guess priority while filing.
The body states the observable problem or requested outcome, reproduction or location, and relevant
environment or context. Search for duplicates before publication.

When a manual or API path is unavoidable, reproduce that same content and label contract. Run the
read-only audit afterward; do not hide malformed intake by assigning an arbitrary priority.

## Audit and triage

Run:

```bash
node scripts/harness/github-issue-triage.mjs audit --repo woojubb/robota
```

Read the issue body, discussion, duplicates, assignee, linked branches and pull requests, and native
dependency edges. Audit mode reports; it never edits, closes, or converts an issue.

For actionable work, keep exactly one work-kind label, remove `status:needs-triage`, and assign one
priority label only when the evidence supports it. Use assignee and linked branch or PR for activity;
do not create a parallel status axis or Task merely to mirror GitHub state.

The canonical issue remains authoritative by default. If the exceptional criteria in `issue-to-backlog`
justify a Task, link it directly and keep one fixed file. Internal decomposition stays in the issue,
Task, or PR checklist; child issues are reserved for independently releasable work with their own user-
visible outcome.

## Label reconciliation

The safe order is dry-run, apply, check:

```bash
node scripts/harness/github-issue-triage.mjs labels --repo woojubb/robota
node scripts/harness/github-issue-triage.mjs labels --repo woojubb/robota --apply
node scripts/harness/github-issue-triage.mjs labels --repo woojubb/robota --check
```

Dry-run reports creates, updates, and unexpected live labels. Apply performs only declared creates and
updates. Unexpected labels are preserved; this tool has no delete action. Registry or protected-consumer
changes must pass `node scripts/harness/scan-github-label-registry.mjs`.

## Completion

After verified delivery, update the authoritative issue with the result and relevant evidence, then
close it when its acceptance criteria are met. A Task marker, conversion command, narrative receipt,
or completion-only commit is never required. Superseded issues receive the direct disposition and link
to the surviving owner.

Stop when issue visibility or pagination is incomplete, labels are ambiguous, ownership conflicts with
active work, or the requested mutation would delete historical labels.
