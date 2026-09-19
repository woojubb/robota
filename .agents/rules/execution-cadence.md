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

The first local whole-branch review establishes the review baseline. Every repair review after it
MUST preserve the same reviewer context: verify prior findings against current source, then inspect
only `git diff <previous-head>..HEAD` for a committed-head loop, or the named repair locations and
newly changed hunks against the retained prior review snapshot for an intentionally uncommitted
loop. Repeat the whole-branch pass only when the repair materially widens the changed set. Context
reuse and delta scoping never replace dynamic execution, regression RED proof, or test-truthfulness
checks required by the review. Convergence is zero unresolved MUST/SHOULD findings; CONSIDER/NIT
items are either included in the current repair batch or recorded at their existing issue/task home,
not grounds for repeatedly re-auditing already accepted content.

Do not repeat a passing review merely because another skill was invoked, an agent handed work
back, a session resumed, or a commit was created. A final-head review requirement still applies:
evidence about changed content cannot be passed off as evidence about the final content.

## One verification owner and one record

Assign one actor to the integrated verification boundary. Workers run focused tests and report
their exact scope and failures; they do not duplicate the complete CI suites locally. The integration
owner verifies the final affected batch once and checks actual required remote results, repeating
only invalidated verification when inputs changed or a run failed. A partial worker result is never
whole-branch green. Preserve required
CI checks, runtime scenarios, regression RED proof, and final independent review.

Before that full gate, integrate every known authorized source, documentation and completion-record
change and settle required parallel work. Do not describe a merge as final or last until this
boundary is reached. This is an execution-owner responsibility, not a new per-edit checkpoint;
the harness cannot infer unrecorded pending human work and does not claim to enforce it mechanically.

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

That Task's later archive is also metadata, not a new plan: only the same-basename source and
completed destination may change. Original approval, a complete existing Plan, N/A scenario and
absence of a paired spec must remain demonstrable; only terminal status and a valid completion
date may differ. This archival allowance supplies no executable planning authority.

Closed post-merge attempts may be preserved by a ledger-only append, including unsuccessful
attempts. Preserve existing lines and unique run identities; reject malformed/open records and
false convergence. Historical storage is neither a verified merge witness nor a planning ground.
A delivery batch still requires its exact successful PR/merge ancestor proof. Required completion
projections and bound existing run closures follow [Tasks README — Process](../tasks/README.md#process),
not a new planning checkpoint. No metadata route admits executable additions.

Enforced by: `scan-user-execution-plan-order` — the shared documentation-batch predicate is reached
by staged checks and both history replay paths. The completion/history predicates use the same
record boundaries in the index and committed trees. Regression tests exercise accepted batches,
archives and closed history, plus mixed-scope, missing-evidence, residue and later-implementation
refusals. Loop-specific terminal semantics remain owned by `scan-loop-run-records`.

Enforced by: `scan-review-findings` mechanically preserves the same-reviewer/delta-review contracts
in the review rule, reviewer agent, and local-review orchestrators. Whether a repair materially widens
the changed set and whether two edits implement the same approved outcome remain semantic judgement;
the integrating reviewer checks those in the existing final review, not in an extra review. The open
mechanism follow-up for duplicate manual invocations remains in the
[recurrence ledger](../evals/lessons/recurrence-ledger.md). Do not add a new per-edit gate to enforce
the prohibition on per-edit gates.
