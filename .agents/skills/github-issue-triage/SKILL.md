---
name: github-issue-triage
description: Audit, triage, select, and convert GitHub Issues using the declared label registry without duplicating Task execution priority. Also reconciles live label definitions through a report-first, no-delete workflow.
---

# GitHub Issue Triage

## Rule Anchor

- [backlog-execution.md](../../rules/backlog-execution.md) > “GitHub Issue Intake and Conversion Queue”
  owns the label set, priority meanings, selection order, and Issue→Task authority handoff.
- [`.github/labels.json`](../../../.github/labels.json) owns exact live label names, descriptions, colors,
  applicability, lifecycle, and declared producers/consumers.
- [issue-to-backlog](../issue-to-backlog/SKILL.md) owns cause grouping and Task creation.

This skill owns procedure only. It does not redefine the queue or make Issues the execution SSOT.

## Audit Intake

Run the read-only audit before a triage session:

```bash
node scripts/harness/github-issue-triage.mjs audit --repo woojubb/robota
```

The output assigns every open Issue to exactly one reported category: intake awaiting triage,
unconverted priority candidate, converted/open-Task linked, or malformed/unclassified. Audit mode never
edits an Issue and never guesses a kind or priority. Use `--check` only when malformed count zero is a
required gate; historical cleanup runs normally use the report without that flag.

## Triage One Issue

1. Read the Issue body, discussion, duplicates, and native dependency edges.
2. Decide whether it is actionable or should receive a documented terminal disposition under the rule.
3. For actionable unconverted work, leave exactly one of `bug`, `enhancement`, or `documentation`.
4. Remove `status:needs-triage` and leave exactly one of `priority:P0`, `priority:P1`, or `priority:P2`.
5. Do not add a status axis for activity or blocking. Use assignee plus linked branch/PR for activity and
   native dependencies for blocking.

Select P0 first, then P1 Issues that unblock other Issues, then the oldest unassigned P1. When no P1 is
available, deliberately promote one P2; never convert P2 directly.

## Convert to a Task

After `issue-to-backlog` creates the exact Task with its source `issue:` URL and mapped `urgency`, dry-run
the handoff:

```bash
node scripts/harness/github-issue-triage.mjs convert --repo woojubb/robota --issue 123 --task .agents/tasks/RULE-001-example.md
```

If the dry-run names the intended Task and P label, finalize explicitly:

```bash
node scripts/harness/github-issue-triage.mjs convert --repo woojubb/robota --issue 123 --task .agents/tasks/RULE-001-example.md --apply
```

Finalization posts one idempotent Task marker, reads it back, then removes the P label. A failure before
read-back leaves priority untouched. A failure during removal leaves the marker plus priority visible as
an incomplete conversion; rerun the same command. Do not start implementation until the command reports
`conversion finalized`.

## Reconcile Label Definitions

The safe order is dry-run, apply, check:

```bash
node scripts/harness/github-issue-triage.mjs labels --repo woojubb/robota
node scripts/harness/github-issue-triage.mjs labels --repo woojubb/robota --apply
node scripts/harness/github-issue-triage.mjs labels --repo woojubb/robota --check
```

Dry-run reports create, update, and unexpected live labels. Apply performs only declared creates and
updates. Unexpected labels are printed as `PRESERVE`; this tool has no delete action. Registry or
protected-consumer changes must pass `node scripts/harness/scan-github-label-registry.mjs` first.

## Stop Conditions

- An Issue has zero or multiple work kinds or P labels.
- `status:needs-triage` remains on a conversion candidate.
- A P2 Issue has not been promoted.
- Task urgency does not match P0→`now` or P1→`soon`.
- Task-marker write/read-back or P-label removal is incomplete.
- A requested label rename/delete affects a protected consumer or historical label.
