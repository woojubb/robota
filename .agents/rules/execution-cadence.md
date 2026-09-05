# Execution Cadence

Mandatory. Parent: [index.md](index.md). This document owns the granularity of execution;
other rules own the substance of approval, testing, review, and release gates.

## Work-unit boundaries, not edit boundaries

Small supplements MUST NOT each acquire a separate review, record, approval request, planning
checkpoint, commit, or full verification run. Fragmenting one approved outcome this way is a
process defect, not extra diligence. Batch related corrections until there is a coherent result
to validate. A work unit is an independently verifiable outcome, not a file, module, test, or
agent handoff; do not rename tiny edits as work units to evade this rule.

Use one approved plan, implement the related changes and LOCAL corrections, validate the integrated
result, obtain an independent review, and deliver the batch. Reuse existing approval and planning
evidence while its scope and design remain valid. A clarification of paths, test ownership, or
implementation sequence within that decision does not restart planning or mint another checkpoint.
Required initial planning and pre-refactor characterization boundaries remain; neither repeats
for each extraction. Later delivery branches retain their required continuation boundary.

## Reopen only what changed

An actual failing check, unresolved review finding, changed verification input, or FOUNDATIONAL
design change can reopen the affected phase. Name that ground in the existing work record and
re-run only the invalidated scope during repair. Resolve all currently known LOCAL findings as a
batch and review that repair batch once; do not obtain a fresh opinion after every fix. A changed
contract or enlarged scope still needs the applicable approval. A small correction within the
approved decision does not need another user question.

Do not repeat a passing review merely because another skill was invoked, an agent handed work
back, a session resumed, or a commit was created. A final-head review requirement still applies:
evidence about changed content cannot be passed off as evidence about the final content.

## One verification owner and one record

Assign one actor to the integrated verification boundary. Workers run focused tests and report
their exact scope and failures; they do not each run the full CI mirror. The integration owner runs
the full required gate on the final batch once, and repeats it only when its inputs have changed
or a run actually failed. A partial worker result is never whole-branch green. Preserve required
CI checks, runtime scenarios, regression RED proof, and final independent review.

Do not run builds and tests concurrently when they write/read the same generated dependency
artifacts. Build the dependency closure once, then run dependent checks against that stable output.

Maintain the existing Task/spec and required machine ledger at phase boundaries. Batch findings,
commands, exit codes, and residual risks there; do not create a new report or ledger run for every
small supplement. Reading a skill for guidance is not executing its loop. An actual separately
executed pipeline keeps its required ledger and signal records; never fabricate or omit those.
Do not create parallel status documents repeating the same facts. Batch implementation commits
and pushes; retain only checkpoints or receipt-only commits required by an actual gate.

## Enforcement boundary

Approved documentation-only batches may contain their Task and changes in the same commit. The
single open Task records `documentation_batch_approval: DIRECT`, a non-empty
`documentation_batch_instruction` quoting the owner, and `SCENARIO DRAFTED: not-applicable | 0`.
No paired spec may exist. The checker admits only non-executable regular Markdown files at
`AGENTS.md`, `README.md`, `.agents/{rules,skills,tasks,evals/lessons}/`, `.claude/agents/`, or `docs/`,
and all paths must remain L0 under the prior committed lane contract. A batch cannot grant itself
a lower lane. Runnable code, scripts, hooks, CI, manifests and gate-contract changes still require
their own planning. Unstaged/untracked work is not hidden by this path. The permission applies only
to that documentation commit; it never grounds later implementation.

Enforced by: `scan-user-execution-plan-order` — the shared documentation-batch predicate is reached
by staged checks and both history replay paths. Regression tests exercise accepted batches and
mixed-scope, missing-evidence, residue and later-implementation refusals.

Enforced by: nothing — deciding whether two edits implement the same approved outcome requires
semantic judgement, and current execution receipts do not identify duplicate manual invocations.
The integrating reviewer checks this rule in the existing final review, not in an extra review.
The open mechanism follow-up is tracked in the [recurrence ledger](../evals/lessons/recurrence-ledger.md):
evaluate duplicate-invocation detection in the next consolidated harness cycle. Do not add a new
per-edit gate to enforce the prohibition on per-edit gates.
