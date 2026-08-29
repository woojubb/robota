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

## Create an Issue (mandatory intake contract)

Write GitHub Issue titles and bodies in English by default. Preserve quoted user text and technical
identifiers when translation would alter the evidence; explain any retained non-English text.

Use one of the three repository Issue Forms for every new Issue:

- **Bug report** → exactly `bug` + `status:needs-triage`
- **Enhancement request** → exactly `enhancement` + `status:needs-triage`
- **Documentation request** → exactly `documentation` + `status:needs-triage`

The forms are the mechanical entry point: blank Issues are disabled, the work-kind label is applied by
the selected form, and the required fields capture an observable problem or requested outcome before a
triager sees it. Do not add `priority:P0`, `priority:P1`, or `priority:P2` while filing an Issue. Priority
is assigned only after a human triager reads the body, discussion, duplicate context, and dependency
edges. Do not use status labels for activity or blocking; use assignee plus linked branch/PR for activity
and native Issue dependencies for blocking.

When a manual or API path is unavoidable, it must reproduce the same contract before publication:

1. Select exactly one of `bug`, `enhancement`, or `documentation` from the Issue's actual claim.
2. Add `status:needs-triage` and no P label.
3. Include the form-equivalent evidence: observed problem, expected/outcome, reproduction or location,
   and relevant environment/context; state whether a duplicate was searched.
4. Run the read-only audit after creation. A malformed result is a failed intake, not an item to hide by
   adding an arbitrary priority.

An agent filing a defect discovered during other work must route through
[`find-to-issue`](../find-to-issue/SKILL.md), which owns the evidence and scope boundary, then return to
this contract for the labels. Filing an Issue never authorizes implementation or Task creation.

Child Issues are exception-only under the rule. When a child is genuinely required, add a non-empty
`## Independent external lifecycle` body section with its observable reason and read both the body and
native parent relationship back. A reviewer other than the author or migration actor must judge the
reason against the rule and record
`Semantic review: @<github-login> on YYYY-MM-DD — RETAIN` in that section. The
structural audit deliberately does not supply this semantic approval. Internal decomposition belongs in
Tasks.

Task decomposition never closes a parent by itself. The canonical Issue body owns the current external
problem and Issue/Task map; exact machine-readable Task-marker comments remain mandatory append-only
receipts even when no narrative comment is useful.

## Audit Intake

Run the read-only audit before a triage session:

```bash
node scripts/harness/github-issue-triage.mjs audit --repo woojubb/robota
```

The output assigns every open Issue to exactly one reported category: intake awaiting triage,
unconverted priority candidate, converted/open-Task linked, or malformed/unclassified. The same ordinary
command also audits native child relationships: every open child is reported exactly once and must carry
a non-empty `## Independent external lifecycle` reason and the exact structured semantic-review receipt.
Pagination or visibility failure fails closed.
Audit mode never edits an Issue and never guesses a kind, priority, or semantic adequacy. Use `--check`
when both malformed intake count and missing child-lifecycle evidence must be zero; historical cleanup
runs normally use the report without that flag.

## Triage One Issue

1. Read the Issue body, discussion, duplicates, and native dependency edges.
2. Decide whether it is actionable or should receive a documented terminal disposition under the rule.
   For a child, verify its independent semantic `RETAIN` review record. Before absorbing or closing it,
   inspect assignee, cited open Tasks, linked open PRs, and live linked branches/worktrees; any one makes
   the row `OWNER_REVIEW` until the responsible owner records dated approval of the exact parent, Task
   mapping, and terminal disposition. Do not mutate an `OWNER_REVIEW` row. A new canonical migration Task
   from an approved frozen manifest is the only prerequisite exception: its mere existence does not force
   `OWNER_REVIEW` after it is readable on `develop`, cites the exact source Issue, and has no assignee,
   implementation branch/worktree, linked open PR, pre-existing Task marker, identity transfer, or active
   execution. Any pre-existing Task or marker and every active signal still force `OWNER_REVIEW`.
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
- An open child Issue lacks readable `## Independent external lifecycle` evidence, or native hierarchy
  pagination/visibility is incomplete.
- A requested label rename/delete affects a protected consumer or historical label.
