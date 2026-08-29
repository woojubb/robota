# Backlog Execution Rules

The backlog invariants: what must hold while executing backlog-driven work through recommendation gates,
user-execution gates, and focused PRs — and **who owns each fact**.
Parent: [process.md](process.md) | Index: [rules/index.md](index.md)

**The ordering is not here.** Which phase runs when, and what each outcome routes to, is owned by
[`backlog-execution-orchestrator`](../skills/backlog-execution-orchestrator/SKILL.md), which dispatches
[`user-execution-scenario`](../skills/user-execution-scenario/SKILL.md) for the scenario lifecycle and is
itself dispatched once per item by
[`multi-backlog-initiative`](../skills/multi-backlog-initiative/SKILL.md) when work spans several items.
The judgement of _whether a recommendation is right_ is owned by the `proposal-reviewer` agent; _whether a
gate passes_ by the [`backlog-gate-guard`](../../.claude/agents/backlog-gate-guard.md) agent against the
[gate catalogue](../specs/gate-catalogue.md); _what a scenario should verify_ by the
[`user-execution-scenario-author`](../../.claude/agents/user-execution-scenario-author.md) agent. This
document states only what must hold, wherever those run.

## GitHub Issue ↔ Task Boundary

GitHub issues and Task files are complementary records, not duplicate work queues.

- A **GitHub issue** captures externally trackable intent or a problem: user value, constraints, scope,
  non-goals, discussion, and links. A parent issue may represent an initiative; a child issue represents
  an independently discussable cause or outcome.
- A **Task** records one executable unit of work: one problem cause, one recommendation gate, one
  verification plan, and one completion decision. A Task may span several packages or files when they are
  one coherent cause and one independently verifiable outcome.
- A **spec-doc** is the plan paired with a Task. It records alternatives, the accepted design, completion
  criteria, affected files, and the test plan. It is neither a GitHub issue nor a substitute for a Task.

Convert issue contents by **cause and independent verification**, not by the number of deliverables,
packages, files, or test suites named. Keep one issue and make several Tasks when the decomposition is
only internal implementation sequencing. Create separate child issues when the causes need separate
external discussion, priority, ownership, security review, or independently tracked disposition.

When one parent issue produces several related Tasks, create a parent `AGREEMENT` Task and its paired
spec-doc to own the shared boundary and child relationship. Do not create an `AGREEMENT` merely because
the work touches several packages. When a feature and its authentication/security policy have different
trust assumptions, failure policy, or verification, keep them as separate causes even if they use the
same transport.

Every Task converted from an issue must cite its source issue. Conversion does not authorize
implementation; an unsplit issue remains open until the tracked work lands or receives an explicit
terminal disposition. When an issue is decomposed into child Issues, the parent must be linked to every
child and closed immediately with a comment naming those children; the children, not the parent, remain
as the open work queue. This prevents repeated decomposition from growing the queue without reducing
it. The `issue-to-backlog` skill owns the conversion procedure; this rule owns the boundary.

### GitHub Issue Intake and Conversion Queue

GitHub priority labels order only the optional front stage: they decide which unconverted Issue becomes
a Task next. Task `priority` and `urgency` are the sole execution authority after conversion. An Issue
priority label is never maintained as a mirror of Task frontmatter.

The label SSOT is [`.github/labels.json`](../../.github/labels.json). Its required Issue core is exactly
one work kind (`bug`, `enhancement`, or `documentation`), intake marker `status:needs-triage`, and one
conversion priority (`priority:P0`, `priority:P1`, or `priority:P2`). There is no P3. Existing non-core
labels remain declared but do not become required workflow axes merely by existing.

- A new Issue Form applies exactly one work kind and `status:needs-triage`.
- Triage removes the intake marker and applies exactly one P label. P0 is an interrupt candidate; P1 is
  the committed next conversion queue; P2 is valid uncommitted intake.
- Selection order is P0, then P1 Issues that unblock other Issues through native GitHub dependency
  edges, then the oldest unassigned P1. P2 must be promoted to P1 before conversion.
- P0 initializes Task `urgency: now`; P1 initializes Task `urgency: soon`. Task `priority` independently
  records impact.
- Conversion is incomplete until an idempotent Issue comment naming the exact Task ID and path is read
  back and every Issue P label is removed. Any failed write-back or label removal prohibits
  implementation. Task-only work remains valid and bypasses this front stage.

Assignee plus a linked branch or pull request is the active-work signal. Native Issue dependencies own
blocking; a status label does not duplicate that relation. No GitHub Project or Project priority field
may mirror this queue. Introducing a Project later requires a deliberate single-owner migration.

The exact PR protocol labels `disposition-containment`, `disposition-re-plan`, and
`review-findings-acknowledged` are protected system labels. Their minimum production consumers are fixed
in `scan-github-label-registry.mjs`, independently of editable registry metadata. They are not renamed or
deleted until every consumer is changed and verified first.

Enforced by: `scan-github-label-registry.mjs` checks the registry, Issue Form references, fixed protected
consumer relations, additive declared consumer relations, and a non-empty examined population.
`github-issue-triage.mjs` owns read-only Issue auditing, ordered fail-closed conversion finalization, and
report-first live label synchronization. Its audit classifies open Issues without guessing or mutating
metadata; synchronization creates or updates declared labels and never deletes unexpected live labels.
The [`github-issue-triage`](../skills/github-issue-triage/SKILL.md) skill owns the human procedure.

## Registration is not authorization — an item may be declined

**An issue being open does not oblige anyone to implement it.** Issues arrive here through many routes —
an audit sweep, a review finding filed rather than absorbed, a scan's output, a passing observation
during unrelated work — and those routes do not share a bar. Some carry a security defect; some carry a
wording preference. A rule that every registered item must be worked would let the cheapest route to
create work set the queue.

So **picking an item up begins with a judgement, and the judgement may be to decline it.** The two
outcomes are symmetric: proceed with reasons, or decline with reasons. Neither is the default, and
"it is open, therefore I work it" is not a judgement.

**A decline is closed, not left open.** An item judged not worth doing and left open is worse than either
outcome — it stays in every count, is re-picked by the next session, and is re-judged from scratch each
time. Close it, with the disposition recorded **on the issue**, where the next reader looks. A Task file
that mirrors it takes the terminal status this file already defines (`wontfix`, `skipped`, `superseded`)
with its date.

**What a decline must contain**, because the grounds are the whole substance of it:

- **What the item claims**, restated — a decline that does not first state the claim usually declines a
  different, easier claim.
- **Why it is not worth doing**, against something outside the decider's convenience: the defect does not
  reproduce, the cost exceeds the harm, a merged change already resolved it, another open item subsumes
  it, or the premise is factually wrong — and if wrong, which measurement shows it.
- **What would reverse the decision.** A decline that nothing could change is a refusal to judge wearing
  the clothes of a judgement. Anyone reopening the issue should be able to read this line and know what
  to bring.

**What is not a ground.** That the item is tedious, unfamiliar, large, poorly written, old, or filed by a
route the decider dislikes. Those describe the decider, not the item. A large item is decomposed or
declined on cost against harm — with the cost stated — never declined for being large.

**Which declines are not the agent's to make alone.** Route by
[Agent Decision Authority](#agent-decision-authority) below, with one addition that follows from what a
decline destroys: an item asserting a **security or data-correctness defect** is not declined on agent
authority. Being unable to reproduce it is a finding to report, not a disposition to apply — the
difference between "this does not happen" and "I did not make it happen" is exactly what a second reader
is for. Recommend the decline with its grounds and let the user decide.

Enforced by: the record half only. `backlog-placement` refuses a terminal status without its
`completed:` date, so a declined item cannot be archived undated, and `task-archival` refuses the
half-finished move. The judgement itself is not mechanizable and no scan is claimed for it: whether the
grounds are sound is the thing being asked, and a machine that could decide it would not need the rule.
What that leaves is visible by construction — the grounds are written on the issue, so a wrong decline is
readable rather than silent, and reopening costs one comment.

Case: [PROC-015](https://github.com/woojubb/robota/issues/2289).

## Agent Decision Authority

When a decision must be made during backlog work, the agent must first determine whether it falls
within agent authority or requires user judgment.

**Agent authority — decide and proceed:**

The agent must form a recommendation with explicit reasoning and may act on it without asking the
user when ALL of the following hold:

- The decision follows clearly from existing project rules, architecture constraints, or repository
  conventions.
- A knowledgeable senior engineer reviewing the reasoning would reach the same conclusion.
- The decision does not change public API contracts, package ownership, dependency direction, or
  module boundaries in a way that requires cross-team coordination.
- The decision is reversible or has a low blast radius (e.g., internal cleanup, dead code removal,
  path constant extraction, naming fix).

When acting on agent authority, the agent must document the reasoning inline — in the backlog item,
PR description, or commit message — so the user can review and override if needed.

**User judgment required — stop and ask:**

The agent must stop and present options to the user when ANY of the following hold:

- The decision involves product direction, feature scope, or user-facing behavior that is not
  dictated by existing rules (e.g., "should this feature exist at all?").
- Multiple architecturally valid approaches exist and the choice has long-term structural impact.
- The decision changes a published or externally visible contract.
- The decision requires business, legal, or strategic judgment (e.g., telemetry opt-in consent,
  third-party service selection).
- The change introduces a practice this repository has not used before — a new workflow, tooling
  convention, file-placement pattern, or verification approach with no existing rule, skill, or
  precedent to point to.
- The change touches repository-wide policy files — lint configuration (`.eslintrc*`), CI
  workflows (`.github/workflows/`), git hooks, or workspace topology (root directories,
  `pnpm-workspace.yaml`, root `package.json` scripts) — even when the change is bundled inside an
  already-approved backlog. Backlog approval covers the backlog's stated scope, not policy files
  it happens to pass through. Backlog wording such as "consider adding X" authorizes evaluation
  and a recommendation, not the change itself.
- The change edits, moves, or deletes a user-authored document (a file the user personally wrote,
  e.g. reports or notes under `.design/`), unless the user has already given disposition for that
  document.

**Disclosure is not approval.** Mentioning a policy-file change or novel practice in a PR
description, commit message, or backlog note does not substitute for asking first. Approval must
be obtained before the change lands. A change disclosed but not approved is a change that has to be
reviewed again after it landed, which is the expensive order to do it in.

### Standing authorization

A user instruction to keep going without asking again — _"멈추지 말고 계속 진행해"_, _"추천안이
타당하면 자동 승인한다"_, or any equally direct standing statement — **outranks the ask-gates above
for decisions that already sit inside agent authority**. It stands until the user revokes it or the
session ends.

This is written as an amendment rather than left implicit because it was not a missing rule but an
unresolved contradiction: the stop-and-ask gates here and in `spec-workflow.md` mandate asking, while
`agent-conduct.md` mandates deciding and acting, and nothing covered an authorization that spans many
turns. The observed cost of leaving it unresolved was the same correction recurring five times in one
session.

**What a standing authorization does NOT cover.** The four classes below stay with the user however
broad the instruction, because each is irreversible, outward-facing, or not the agent's to judge:

1. Product direction and user-facing scope.
2. A published or externally visible contract.
3. Repository-wide policy files — lint configuration, CI workflows, git hooks, workspace topology.
4. A user-authored document.

A merge into `main` remains the user's alone under [git-branch.md](git-branch.md), and no standing
authorization reaches it.

**Recording is what makes it auditable.** When acting under a standing authorization, quote the
instruction **verbatim** in the work item, and state which decisions it covered. An authorization
that is paraphrased cannot be checked against what the user actually said, and a session summary is
not the user.

Enforced by: nothing — whether an
utterance is a standing authorization, and whether a given decision already sits inside agent
authority, are both judgements about intent; a check that guessed either would be wrong in exactly
the cases that matter. What IS mechanized is the boundary this rule may never cross: a merge into
`main` is refused by `.claude/hooks/merge-gate.sh` and by the `protect-main` ruleset, and a push is
refused by `.claude/hooks/pre-push-check.sh` until its review exists — so the most expensive way to
misread a standing authorization is blocked by a machine regardless of how the prose is read.

**Never write "사용자 결정 필요" without first presenting a concrete recommendation.** Every
open decision in a backlog item must include the agent's recommendation and the reasoning behind it.
A decision that falls inside agent authority by the four criteria above may be acted on; one that does
not, or that forms part of the work unit's recommendation, goes through the Recommendation Gate below
and is never self-approved. If genuinely uncertain, the agent presents two to three options with
trade-offs and asks the user to choose.

### Delegated Approval Classes

**SSOT for the delegated-class registry and the GATE-APPROVAL evidence form.**
`gate-catalogue.md` § GATE-APPROVAL points here and does not restate any of it.

Distinct from **Standing authorization** above, and the distinction is the whole point. That section
governs _decisions taken during work that already sit inside agent authority_, and it correctly records
**"Enforced by: nothing"** — whether an utterance is a standing authorization is a judgement about
intent. This section governs something narrower and mechanically checkable: whether a **spec document**
may pass GATE-APPROVAL on an instruction that was not given for that document. A standing
authorization to keep working is not, on its own, approval of any particular spec.

**Why a registry rather than an argument.** Both mature prior arts for standing authorization put the
class in a register written before the instance. ITIL 4's _standard change_ is pre-authorised because a
documented **change model was registered in advance**; an unregistered change takes the full
authorization path however low-risk it looks. An AWS IAM **permissions boundary** _"defines the maximum
permissions … but does not grant permissions"_ and is evaluated by the system, so a delegate cannot
widen it by reasoning. Neither lets the party exercising the authority also decide the instance is
inside it. An agent arguing at approval time that its item resembles a delegated class is precisely the
half neither permits to stand alone.

**Registry.** Each entry is a row. An entry authorises approval only for items that match its Scope
**and** satisfy its Evidence condition.

| Class ID                 | Scope — what falls inside                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Evidence condition                                                                                                                                                                                                                                                                                                                                                                                                                             | Authorising instruction (verbatim)                                                                                                                                                                                           | Registered |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `LANE-L0-L1`             | L0 and L1 items as `spec-workflow.md` § Lanes defines them, judged by `scan-lane-declaration` <!-- allow-citation: the Registered column is the boundary a citing approval may not predate; the date is the criterion, not a narrative -->                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `scan-lane-declaration` exits 0 on the branch and the declared lane is L0 or L1                                                                                                                                                                                                                                                                                                                                                                | "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘" — given in reply to the proposed row text "L0·L1 레인 항목은 `spec-workflow.md`의 레인 정의대로 사전 승인한다"                      | 2026-08-28 |
| `BACKLOG-ZERO-MIGRATION` | Documentation-only terminalization or GitHub-issue handoff of the finite legacy Task/spec population fixed at Git object `2c875dd3ec6938d6eb0563b50c40d1f116fb4e7e`; each batch must commit a `## Migration Manifest`, contain at most 6 units and 15 paths, and record exact paths/blobs, current ownership/reservations, evidence, disposition, and baseline rekeys. The approved manifest is immutable: any post-approval change requires a fresh approval. It excludes package/app source, APIs/contracts, policy/gate documents, skills/workflows/hooks/topology, and product/user documentation. <!-- allow-citation: the Class ID and date are part of the owner's exact authorising instruction and the registration boundary the scanner compares --> | For every manifest unit: revalidate current truth and concurrent ownership; map delivered criteria to merge-commit ancestry plus current evidence, or create/read back one exact OPEN GitHub issue and append the handoff before independently terminalizing each Task and spec as skipped/rejected. Issue creation is idempotent and may only create or comment; no edit, close, or metadata mutation. No-growth baseline mappings are exact. | "DOCS-029 승인함. BACKLOG-ZERO-MIGRATION 클래스를 등록하고, 2026-08-28 기준 기존 backlog를 GitHub issue로 이관하거나 이미 전달된 기록을 종결하는 문서 전용 배치를 자동 승인하도록 위임함. 패키지 소스/API/정책 변경은 제외." | 2026-08-28 |

The `LANE-L0-L1` row above was registered by the item that introduced the lanes (PROC-016). <!-- allow-citation: the registering item is the audit trail for the row -->
Its scope is the two lanes as the lane rule defines them, and an agent may not widen it — not by editing
the row, and not by reading "L0 and L1" as anything other than what `scan-lane-declaration` accepts.

**The registry shipped empty, and that was the design, not an omission.** It holds two independently
authorised rows since
2026-08-28. <!-- allow-citation: the date is the registration boundary the scan reads -->
Registering a class grants
standing approval authority over every future item inside it, so a registry entry is itself a user
decision under the ask-gates above — "the change introduces a practice this repository has not used
before". **An agent may never add its own registry row.** A row is added only by a user instruction
that names the class and its boundary, recorded verbatim in the row. Until a row exists, every spec
document takes Route DIRECT, which is the behaviour before this rule and therefore fails closed.

**A class may not be registered retroactively.** The `Registered` date is the date the user authorised
the row. A spec document may cite a class only if its own approval date is on or after that date. This
is what makes the rule unable to bless records written before it existed.

**Never inside any class**, however the row is worded — these are the four exclusions from Standing
authorization above, unchanged and not restated in any row:

1. Product direction and user-facing scope.
2. A published or externally visible contract.
3. Repository-wide policy files — lint configuration, CI workflows, git hooks, workspace topology.
4. A user-authored document.

Plus one the approval gate adds: **a change to the rule documents that define the gates themselves**,
including this section and `gate-catalogue.md`. A delegated class may not be used to approve a change
to what delegation means.

**A relay is not an instruction.** An instruction reported by another session, subagent, or document —
rather than given in the conversation where the approval is being recorded — is recorded as context and
authorises nothing on its own. This is not a slight on the reporting session; it is that a paraphrase
cannot be checked against what the user actually said, which the Standing authorization section already
states for the same reason.

**Evidence form.** A GATE-APPROVAL entry MUST carry these fields, in this shape, so that DIRECT and
CLASS passes are distinguishable at a glance and countable by machine. `standing-delegation-evidence`
parses them; an entry it cannot parse is a FAIL, never a pass.

The fields go under the Evidence Log's existing GATE-APPROVAL heading, whose shape
`gate-catalogue.md` already owns. Only the fields are specified here.

Route DIRECT:

```markdown
**Approval route:** `DIRECT`
**Instruction (verbatim):** "<exactly what the user typed or selected>"
**Given:** YYYY-MM-DD, this conversation
```

Route CLASS:

```markdown
**Approval route:** `CLASS`
**Class:** `<Class ID from the registry>`
**Instruction (verbatim):** "<exactly what the user typed or selected>"
**Given:** YYYY-MM-DD, <the conversation it was given in>
**Evidence condition met:** <the measurement, with its command and output — not an assertion>
```

<!-- The heading line is deliberately NOT reproduced inside these fences. A fenced `### …` is still a
     line beginning with `###`, and `new-rule-declares-enforcement` reads it as a rule section — an
     example that documents a form should not create a phantom rule by being written down. -->

Enforced by: `standing-delegation-evidence` in `pnpm harness:scan`. It reads the route, every evidence
form field, and every registry field. It fails closed on a missing route; an unparseable, incomplete,
duplicate, or mixed-sentinel registry row; a missing or unterminated leading instruction quote; a
class absent from the registry; a class registered after the approval date; missing DIRECT `Given`;
missing CLASS `Given` or `Evidence condition met`; a CLASS entry with no verbatim instruction; and a
CLASS instruction whose exact Unicode code points differ from the registry's leading quoted payload.
What it deliberately does NOT decide is whether an item's _substance_ falls inside a registered
class — that judgement stays with the scope wording in the row, which is why the scope column is
required to be specific enough to be read against a diff.

---

## Recommendation Gate

A recommendation gate must be presented before starting each backlog or meaningful work unit inside a
backlog. The recommendation must include:

- the proposed implementation or documentation approach;
- why it matches the backlog intent;
- why it matches repository rules, layering, ownership, and architecture boundaries;
- affected packages, docs, or commands;
- the expected test and verification plan;
- the expected user execution test scenario plan when the backlog changes runnable user-facing
  behavior, or the not-applicable reason when it does not;
- open decisions within agent authority (with the agent's recommendation and reasoning) or, if
  genuinely outside agent authority, a clearly stated question with two to three concrete options.

**The recommendation is not judged by the actor that formed it.** Whether it is coherent with repository
rules, layering, architecture, and the backlog intent is an independent verdict, produced by the
`proposal-reviewer` agent — a role that both produces and judges violates
[enforcement-architecture.md](enforcement-architecture.md). Work proceeds on `ENDORSE`; a `REVISE` is
folded in and re-reviewed; a `REJECT` is never overridden. The gate's routing (including the bound on
revisions) is owned by
[`backlog-execution-orchestrator`](../skills/backlog-execution-orchestrator/SKILL.md).

An endorsement is not approval. A recommendation that requires product judgment, changes ownership
boundaries, or introduces a new dependency direction still stops for the user.

**The verdict must be recorded** — the reviewer's `REVIEW VERDICT` and its date go in the backlog item
or the PR description. A gate whose verdict leaves no trace cannot be audited, and an unrecorded
`ENDORSE` is indistinguishable from a self-approval.

## One-Backlog-At-A-Time Rule (mandatory, zero exceptions)

**Finish one backlog completely before starting the next.** Complete means: implementation, tests, and
verification done; every changed file committed so the working tree is clean before the PR is created; the
PR opened and merged into `develop` (or the initiative base branch). Only after the merge may the next
backlog begin.

**Merge is the terminal outcome, not an optional handoff.** A pending or failed check is a work state,
not permission to stop and report partial delivery. The owning session must continue the bounded
observe→diagnose→fix→recheck loop, using the no-progress escape in
[`enforcement-architecture.md`](enforcement-architecture.md) when the same failure recurs unchanged,
until the PR is confirmed `MERGED` and the merge commit is an ancestor of `origin/develop`. A final
report must include that confirmation; otherwise the work is `in-progress`, never complete.

**Violations:**

- Starting a new backlog while the current backlog's PR is open or unmerged → stop, merge first.
- Leaving uncommitted files (modified, staged, or newly tracked) after declaring a backlog done →
  stop, commit or discard them before opening the PR.
- Combining work from two separate backlogs in one PR → not allowed unless the backlogs were
  explicitly split into a single named work unit before implementation began.

**Automated enforcement:** `scripts/harness/pre-push.mjs` calls `assertCleanWorkingTree()` at
startup. Any push with modified or staged uncommitted files is blocked with exit code 1.

## PR Unit Rule

- Treat one backlog as one PR by default.
- If a backlog is too large, split it into explicitly named work units before implementation; each
  work unit must have its own recommendation gate.
- Do not combine unrelated backlogs in one PR.
- **This default is not an anti-batching rule.** A single coherent work-unit (one design-gate pass,
  one authoring pass, a rule + its enforcement + its wiring) belongs in ONE multi-commit PR — do not
  split it into many tiny PRs that each wait on a full CI run. Bundle by coherence + a soft size ceiling
  (~600 changed lines / ~15 files); see the [PR Batching policy](git-branch.md) for the exact criteria. The line: **unrelated backlogs → separate PRs; related steps of one unit →
  one PR.**
- **Sequence by relatedness.** Decide the execution shape from whether items share files or contracts:
  items that touch the **same files/contracts are related — serialize them** (one ordered unit, or
  sequential PRs on the same seam) so reviews and merges do not interleave or conflict. Items that are
  **genuinely disjoint are unrelated — deliver them as separate PR units** and let their read-only work
  (audits, reviews, independent analyses) fan out in parallel. Parallelism applies to that read-only
  fan-out and to independent PR _units_, **not** to concurrently-open feature branches — the
  [One-Branch-At-A-Time rule](git-branch.md) still holds: branches are created and merged one at a time
  to avoid divergence. So: related → serial; unrelated → separate units, still merged in sequence.
- A PR description MUST open with `## Background` — what is broken or missing, who is affected, and
  why it matters, for a reader who was not in the session — then `## Purpose`, `## What changes`,
  `## Why this way` (the accepted recommendation, the alternatives, its `REVIEW VERDICT` and depth
  verdict), `## How it was verified` (tests run; the user execution test scenario gate result or
  not-applicable reason), `## Not in this PR` (residual risks and the filed items that own them), and
  then `Closes #N`. A PR description MUST NOT carry an agent-session link or a "Generated with …"
  footer; `Co-Authored-By` on commits is attribution and stays. This section owns the PR body:
  `.github/PULL_REQUEST_TEMPLATE.md` is its copy for human authors, [agent-conduct.md](agent-conduct.md)'s
  formatting discipline points here, and the commit-message half lives with commit format in
  [git-branch.md](git-branch.md) § Git Operations.
  Enforced by: `review-gate` (the pr-body step judges the first heading and the links, not the order of
  the later sections — that half is prose-owned), `no-session-link` (commitlint, the commit half)

## User Execution Test Scenario Rule

Every backlog that changes runnable user-facing behavior, command behavior, TUI/browser behavior, or
workflow behavior must include a `## User Execution Test Scenarios` section before implementation
starts.

**Mechanized** by `scripts/harness/scan-spec-user-execution-section.mjs` (`harness:scan`
`spec-user-execution-section`): a spec document in a folder whose status means implementation has
started — `active/` and `done/`, derived from [spec-workflow.md](spec-workflow.md)'s own
status→folder table rather than copied — must carry the section. Work that delivers no runnable
user-facing behavior satisfies it with the reasoned not-applicable entry the bullets below require,
so the scan asks for the SECTION, never for an invented scenario.

Documents that predate the scan are frozen by name in
`scripts/harness/spec-user-execution-baseline.json`. That baseline is an exempt **set**, not a count:
a new document can never borrow an older one's exemption, the set may only shrink, and an exemption
is keyed to the document's folder so a gate transition re-governs it.

### Pre-implementation planning checkpoint

The section floor above proves content, not order. Before implementation begins, every work unit must
record one subject-bound PLAN terminal outcome in its exact Task: `not-applicable` carries the author
verdict plus its concrete reason; an applicable outcome carries the author verdict plus a
`DONE-GATE-STAGE-1` PASS. GATE-IMPLEMENT judges that outcome while the whole worktree contains no change
outside the paired Task/spec planning artifacts.

The guardian's PASS, the status transition, the paired Task/spec, and any subject-bound PLAN ledger
record are then committed as one dedicated **planning checkpoint**. No other path—including a rule,
skill, or documentation Markdown file—is planning merely because it is text. Implementation may begin
only when that checkpoint is an ancestor of HEAD.

A work unit whose spec's § Decision sequences delivery across more than one PR MUST open each later
PR's branch with a **continuation checkpoint**: a GATE-IMPLEMENT re-run on the `in-progress` document,
recorded in the continuation form the gate catalogue enumerates and committed alone with the pair
before any implementation path. The first checkpoint, already on the base, does not bind a later
branch — the scan requires a checkpoint inside the branch's own range.

Mechanized by `scripts/harness/scan-user-execution-plan-order.mjs`: Husky invokes `--staged` before each
commit, and `harness:scan` replays every commit after the topic merge base. Both fail closed for a
missing, mixed, ambiguous, retrospective, or unreadable checkpoint. The only pre-checkpoint non-pair
change admitted is one append-only closed `post-merge-cycle.jsonl` record whose referenced merge commit
is already an ancestor of the topic base; altered history, unverifiable provenance, or any additional
path fails.

Enforced by: `user-execution-plan-order`

### Checkpoint evidence contract

Enforced by: `user-execution-plan-order`

This section is the single machine-readable owner of the evidence forms written and consumed at the
pre-implementation checkpoint and DONE-GATE-STAGE-1. The gate catalogue references these form names;
writers and validators parse this declaration rather than maintaining private Markdown-token schemas.
The declared scope is GATE-IMPLEMENT first/continuation entries and DONE-GATE-STAGE-1 scenario entries.

<!-- checkpoint-evidence-contract:v1:start -->

```json
{
  "version": 1,
  "entryEncoding": {
    "startMarker": "<!-- checkpoint-evidence:v1:start -->",
    "fence": "json",
    "endMarker": "<!-- checkpoint-evidence:v1:end -->",
    "multiplicity": "exactly-one"
  },
  "priorPassDigest": {
    "algorithm": "sha256",
    "encoding": "lowercase-hex",
    "source": "prior-complete-gate-implement-entry-raw-utf8"
  },
  "decisionArtifacts": {
    "section": "Architecture Review/Decision",
    "linePrefix": "**Continuation artifacts:** ",
    "separator": ", ",
    "token": "markdown-code-repository-path",
    "multiplicity": "exactly-one"
  },
  "actionMapping": {
    "automatable:robota-cli": "command",
    "automatable:robota-tui": "command",
    "automatable:robota-browser-ui": "browserSteps",
    "automatable:public-sdk-example": "command",
    "manual:robota-tui": "uiSteps",
    "manual:robota-browser-ui": "uiSteps"
  },
  "forms": {
    "gateImplementFirst": {
      "heading": "GATE-IMPLEMENT",
      "statusUpgrade": "approved → in-progress",
      "specFolder": "todo",
      "payloadKeys": [
        "version",
        "form",
        "taskPath",
        "specPath",
        "taskItems",
        "plan",
        "worktreePaths"
      ]
    },
    "gateImplementContinuation": {
      "heading": "GATE-IMPLEMENT",
      "statusUpgrade": "in-progress → in-progress (continuation)",
      "specFolder": "active",
      "payloadKeys": [
        "version",
        "form",
        "priorPass",
        "sequencedArtifacts",
        "ancestorSha",
        "taskPath",
        "specPath",
        "plan",
        "worktreePaths"
      ]
    },
    "doneGateStageOne": {
      "heading": "DONE-GATE-STAGE-1",
      "statusUpgrade": "scenario drafted → scenario written",
      "payloadKeys": ["version", "form", "outcome", "scenarios"],
      "scenarioKeys": [
        "name",
        "surface",
        "surfaceRationale",
        "invocation",
        "observableType",
        "observable",
        "observableRationale",
        "guardianObservableVerdict",
        "executability",
        "prerequisite",
        "action",
        "expectedObservable",
        "cleanup",
        "evidence"
      ],
      "conditionalScenarioKeys": [
        "productStatePath",
        "barrier",
        "unavailableCapability",
        "attemptedAutomation",
        "uiSteps"
      ]
    }
  }
}
```

<!-- checkpoint-evidence-contract:v1:end -->

The declaration is closed: unknown versions, forms, fields, duplicate members, malformed JSON, or
missing/duplicate regions fail by name. Each evidence payload appears exactly once between the declared
entry markers in one `json` fence. Payload keys occur exactly once in declared order; paths are
normalized repository-relative strings, arrays preserve declared source order, and unknown keys fail.

`taskItems` mirrors GATE-IMPLEMENT coverage deterministically: complete TC-ID coverage wins and records
`{ "kind": "tc-id", "value": "TC-NN" }` objects in Completion Criteria order; otherwise sufficient
checkbox coverage records every checkbox label in Task source order. `plan` binds the exact Task author
outcome/count, and `worktreePaths` is the sorted exact planning-only inventory.

Continuation `priorPass` is `sha256:` plus lowercase sha256 of the prior complete GATE-IMPLEMENT
entry's raw Git-blob UTF-8 bytes, from its level-3 PASS heading through the byte before the next
level-1–3 heading or EOF, without normalization. `sequencedArtifacts` is extracted in order from the
single exact `**Continuation artifacts:** ` line under `### Decision`, whose values are comma-space
separated Markdown code repository paths. At checkpoint time it binds planned scope; it does not claim
the paths have changed. `ancestorSha` is the preceding merge commit's full lowercase SHA.

Stage-1 required keys follow `scenarioKeys`; conditional keys follow their declared order.
`productStatePath` is required only for `product-state-file`; the barrier trio only for manual; and
`uiSteps` only for manual `robota-tui`. Action selection is exactly the declared outcome/surface map.
Manual TUI keeps its start command in `invocation` and its interaction in `action: uiSteps`.

**Script home**: disposable live-verification scripts (evidence runs, repro probes)
live in `scratch/src/` — a gitignored workspace home whose committed skeleton resolves
`@robota-sdk/*` imports. Never park them inside `packages/` or `apps/`; the
`temp-script-placement` harness scan blocks temp-pattern files there.

User execution test scenarios are separate from the agent's engineering test plan:

- The engineering test plan covers unit, integration, type, harness, CI, build, and internal
  verification commands. A user execution test scenario is what the user can personally execute to
  see the product change working — never any of those (authoritative statement: Done Gate below).
- The user execution test scenario describes the exact product command, UI interaction, browser
  flow, TUI flow, or public SDK/example flow a user can run after the work is implemented to confirm
  the implemented code or delivered artifact behaves as intended.
- A valid user execution test scenario must use a product surface. Product surfaces include the
  Robota CLI command or local equivalent that invokes the same product binary, Robota TUI actions,
  Robota browser UI flows, and public SDK/example usage for SDK-only features.
- For `agent-cli` and command-package backlogs, the default user execution test scenario surface is a
  Robota CLI or TUI action, such as `robota ...` or the repository-local command that invokes the
  same CLI entrypoint.
- For code-changing backlogs, the user execution test scenario must exercise the implemented code
  path. A documentation search, backlog review, or static text check may not be used as the user
  execution test scenario gate for code implementation work.
- For documentation-only, rule-only, skill-only, backlog-only, or governance-only changes that do
  not deliver runnable user-facing behavior, do not invent a user execution test scenario. Mark the
  user execution test scenario as not applicable and record verification evidence in the engineering
  test plan instead.
- If documentation changes describe a user procedure, any user execution test scenario must execute the
  documented procedure itself. It must not inspect the document to prove the document is well
  written.

### Scenario Design Preference Order (mandatory for new scenarios)

**Which surface a scenario should target**, and the ranked preference between them, is judgement applied
while authoring — owned by the
[`user-execution-scenario-author`](../../.claude/agents/user-execution-scenario-author.md) agent, not
restated here. Two invariants bound that judgement wherever it happens, including when no agent is
dispatched:

- A scenario that requires live credentials or an external service **MUST state that prerequisite
  explicitly**, so an executor without it knows the gate cannot run in their environment rather than
  discovering it mid-gate. A step requiring a live model transcript is unexecutable in an environment
  without those credentials, and finding that out at the gate is finding it out too late.
- A scenario whose only observable requires credentials the executor may not have is a design smell —
  restructure toward a provider-free observable or a fixture the work itself ships — an in-repo test
  server in place of a live one makes the whole scenario machine-executable.

Each user execution test scenario must include:

- the agent-executability decision (`agent-executable` or `manual-only: <reason>`);
- a canonical `product surface:` identity: `robota-cli`, `robota-tui`, `robota-browser-ui`, or
  `public-sdk-example`; CLI/TUI commands begin with `robota` or `pnpm exec robota`, browser scenarios
  name exact `browser steps:` when agent-executable or `UI steps:` when manual, and SDK examples invoke
  a literal path below `examples/` or `scratch/`;
- the matching canonical `surface rationale:` (`shipped-entrypoint=robota`,
  `shipped-interface=robota-browser-ui`, or `shipped-interface=public-sdk-example`);
- prerequisite state, sample setup, fixture data, server startup, environment variables, or other
  test environment requirements;
- exact Bash command (for agent-executable CLI/TUI/SDK), exact browser steps (for agent-executable
  browser UI), or exact UI steps (for manual-only) in order; a manual TUI scenario records both its
  canonical `robota` start command and the interactive UI steps;
- a canonical `observable type:` compatible with the surface: `product-output` or
  `product-state-file` for CLI, `product-output`, `ui-state`, or `product-state-file` for TUI,
  `ui-state` for browser UI, and `sdk-result` for public SDK examples;
- its matching `observable rationale:` (`source=product-process`, `source=rendered-product-ui`,
  `source=public-sdk-return`, or `source=robota-state-artifact`);
- expected observable result, including exit code, output substring, visible UI state, or file
  change;
- any cleanup or reset step;
- the evidence field that must be updated after implementation when the agent runs the scenario.

These are canonical single-line fields: each required label appears exactly once with a nonempty value.
Expected values use a type-specific shape: `exit=<code>; output-contains=<literal>`,
`visible=<state>`, `result=<SDK value>`, or `change=created|updated|deleted`; a state-file scenario also
names a `product state path:` below `.robota/`. Product invocations may not chain or substitute another
command; the only allowed pipeline is a single product command piped to `grep`. Shell quoting must be
balanced. Public SDK/example paths are shell-tokenized, reject variable/glob expansion, are normalized,
and must remain below `examples/` or `scratch/` (a lexical prefix followed by `..` is not inside the
surface). Direct examples may use `node`, `tsx`, or `pnpm exec tsx`; all three support only
`--enable-source-maps`, `--no-warnings`, and `--trace-warnings` before the literal script path, and
code-loading/test-runner options are not canonical. The directory form is exactly
`pnpm (--dir|-C) <examples-or-scratch-path> run <literal-script-name> ...`.

A `manual-only` scenario additionally records three mechanically bound fields: `automation barrier:`
(`physical-device`, `credential-bound-service`, `platform-api-unavailable`,
`accessibility-tree-unavailable`, or `sandbox-restriction`), `unavailable capability:`, and
`attempted automation:`. A prose assertion that automation is unavailable is not barrier evidence.
The Stage-1 guardian owns the semantic judgment that a surface and observable are genuinely product
behavior rather than engineering verification. Its PASS entry records
`guardian-observable-verdict=product-behavior` and repeats the exact canonical surface, surface rationale,
invocation, observable type, expected observable, and observable rationale for each named scenario; for
manual scenarios it also repeats those three barrier values, and a manual TUI repeats the exact UI steps
in addition to its start command.

If the scenario requires a test fixture, demo command, local server, test project, seed data, or other
environment that does not exist yet, the agent must either build that environment as part of the
backlog, propose it in the recommendation gate, or ask the user for a decision before proceeding.

### Capability Reachability — no library-seam "N/A" dodge — MANDATORY

When a backlog delivers a **user-facing capability** (something a user would experience — e.g. memory,
retrieval, a new tool or mode) but the slice implements only a neutral **library seam** that no product
surface yet enables, the user-execution gate **must not** be marked "not applicable." A user-facing
capability is not done until it is BOTH:

1. **Reachable via a product surface** — some surface (CLI/TUI/app/public-SDK) actually turns the seam on
   (injects/enables it), so a user can reach the behavior; and
2. **Verified by an AGENT-RUN end-to-end scenario the agent executes itself** — the agent drives the real
   product surface with a real provider, exercises the capability end-to-end, and captures the evidence.
   **The agent never delegates this run to the user.**

The spec/backlog **PLAN must include the surface-wiring + the agent-run verification step from the start.**
Splitting surface-wiring into a later slice is allowed, but an intermediate **library-only** slice records
its engineering evidence and **names the still-pending agent-run verification** — it must NOT claim the
capability "done," and the capability's epic is not COMPLETE until the agent-run verification passes. (This
closes the loophole where a library seam no surface enables silently marks the user-execution gate N/A —
the gap that lets a capability ship switched OFF in the real agent, unverified end-to-end.)

**Mechanical floor.** A capability spec DECLARES itself with three frontmatter keys —
`capability: true`, `user_execution: agent-run | manual | none`, and (for `agent-run`)
`user_execution_scenario: <path>` naming the evidence file EXPLICITLY. `scan-capability-reachability.mjs` (in
`run-all-scans`) then enforces, over `.agents/spec-docs/done/`: a `capability: true` spec MUST NOT record
`user_execution: none`/omit it (no N/A dodge), and a `capability: true` + `user_execution: agent-run` spec MUST
name a `user_execution_scenario:` path that EXISTS. The reference is an explicit path, NOT a name/base-ID
guess — a spec's evidence may live under a scenario named after the work that produced it rather than
after the spec that needs it. `check-spec-doc-frontmatter.mjs` documents all three keys as recognized optional frontmatter.
The floor is opt-in — the scan never GUESSES which spec is a capability (that semantic call, and "is the seam
truly reachable," stay with the GATE-COMPLETE reviewer); it fences the recurrence once the capability is
declared. Set these keys on every user-facing capability spec (add `user_execution_scenario:` for agent-run).

### Agent Executability Requirement — MANDATORY

**Before writing a scenario, the agent must ask: "Can I execute this via Bash right now?"** This question
must be answered before the scenario is written, not after.

- **Agent-executable** is the default and the expected answer. Agent-executable scenarios use
  non-interactive CLI flags (`--version`, `--check-update`, `-p`, `--no-session-persistence`),
  pipe-friendly invocations, or scripted HTTP/file operations.
- **Not agent-executable** — the scenario must be redesigned before it is written, by finding an
  equivalent agent-executable path that exercises the same implemented code. Example: interactive TUI
  cannot be automated, but `--version` (module load), `-p` (CLI assembly), and `--check-update`
  (startup + shutdown) together cover the same code paths without interactive input.
- **`manual-only:` requires a specific technical reason** (e.g. "Ink requires TTY raw mode which is
  unavailable in non-interactive agent execution") and is the exception, not the default.

**Writing scenarios that the agent cannot execute is a process violation.** An unexecutable scenario
that is not labeled `manual-only:` at write time means the agent already knows the done gate will fail
before implementation even begins. A scenario the agent cannot execute and has not labeled `manual-only:`
is not acceptable.

The bound on the redesign search, and what happens when it is exhausted, are routing owned by
[`user-execution-scenario`](../skills/user-execution-scenario/SKILL.md).

## Evidence

Before declaring a backlog or work unit complete, the agent must execute the user execution test
scenario as a final gate whenever the scenario is command-line, file-system, HTTP, browser, or
otherwise available from the workspace. The gate passes only when the observed result matches the
expected observable result, and only when the scenario was run against the completed implementation
or delivered artifact.

**Rewriting a scenario's expected result to match what was observed is forbidden** — that converts the
gate into a transcript of whatever happened. A wrong expectation is corrected by re-authoring the
scenario before the run, never after seeing the output.

Evidence is mandatory. A user execution test scenario gate without captured evidence does not pass.
Evidence may be command output, exit code, screenshot, log excerpt, rendered UI observation,
changed-file diff, or another concrete artifact that proves the expected observable result occurred.
After running the scenario, the agent must update the backlog item with the observed evidence before
the backlog can be considered complete.

**Durable-artifact evidence rule.** For code-changing backlogs, evidence MUST
reference durable artifacts — test file paths that exist in the repository. Evidence sections of
completed backlogs are continuously re-validated by `pnpm harness:scan:done-evidence`
(`scripts/harness/check-done-evidence.mjs`, part of the `harness:scan` aggregate): a referenced
repo file that no longer exists fails the scan. When a later refactor legitimately retires a
referenced artifact, annotate the reference with `<!-- evidence-superseded: <reason> -->` on the
same or the preceding line — exemptions are reported on every run, never silent.

## Done Gate

**ABSOLUTE RULE.** A backlog item with a `## User Execution Test Scenarios` section must not have its
status set to `done` (or equivalent completion marker) until BOTH stages below pass. Setting
`status: done` before both stages pass is a process violation with no exception other than the explicit
`manual-only` or `not-writable` exception documented in the scenario itself.

### The record's own criteria must be met, and that is checked

A `status: done` record leaves no `- [ ]` unticked.

Enforced by: `unearned-done-claims` (rule U5) in `pnpm harness:scan`. It judges every heading in the
record except `Children` (other items' state) and `File Format` (documentation OF the syntax).

The other four rules of that scan judge content that is PRESENT — an empty evidence field, an
uncited evidence heading, a dangling section reference, a ticked box whose claim cites nothing. None
is about a criterion that is present and unmet, which is the shape that costs most: `status: done`
is what the next reader trusts instead of opening the file.

A criterion that survives completion is named on its own line with
`allow-unmet-criterion: <reason>`. The reason belongs on the box's line, because one a paragraph
away could be excusing a different box. Records that already carry unmet criteria are frozen in
`scripts/harness/unmet-criteria-baseline.json` as a burn-down: the counts may FALL and never rise,
and a count that falls is re-frozen in the same change.

### Done Gate Stage 1 — Scenario Written

Every scenario is fully written. Passes by exception only when writing is genuinely impossible AND a
valid reason is recorded explicitly under each unwritten scenario; an unwritten scenario with no stated
reason does not pass.

### Done Gate Stage 2 — Scenario Executed

Every scenario was directly executed by the agent against the completed implementation, the observed
result matched, and concrete evidence was recorded in the backlog item. Passes by exception only when
execution is genuinely impossible AND a valid, specific reason is stated under the scenario that could
not be executed.

**The criteria each stage checks** are the `DONE-GATE-STAGE-1` / `DONE-GATE-STAGE-2` entries in the
[gate catalogue](../specs/gate-catalogue.md); the verdict is produced by the
[`backlog-gate-guard`](../../.claude/agents/backlog-gate-guard.md) agent, never by the actor that did the
work.

**Capability-absence claims require a probe.** "The environment lacks X" (an API key, credential,
tool, or device) is not a valid exception reason unless the agent actually probed for it and records
the probe as evidence (e.g. which env vars / `.env` files / settings surfaces were checked and what
they contained). An unprobed absence claim is a guess, not a reason — the one time it was written
without a probe, the capability existed and the skipped live run would have caught a real bug that
every unit and integration test missed.

**Engineering verification is NEVER User-Execution evidence (authoritative statement).** Build,
typecheck, lint, unit tests (any count), harness checks, CI checks, static/document/backlog/source
inspection, and `rg` checks are engineering or governance verification: they belong in `## Test Plan`,
have zero influence on whether a user can run the product and observe the expected behavior, and must
never be cited as gate evidence, exception reasons, or in a final response as user execution test
scenario evidence. Every other mention of this rule in this file, in the gate catalogue, and in
`common-mistakes.md` #56 refers back to this statement.

If the scenario cannot be executed (genuinely manual-only or terminal-interactive-only), the item
must be labeled `manual-only` with the specific reason before status is set to `done`, and the PR
description must not claim the gate passed by execution.

When the gate passes, the final user-facing response must tell the user that the scenario was verified,
provide the concrete command or UI steps the user can run, state the expected result, and summarize the
evidence already observed by the agent. If the gate does not pass, the work is not complete — the routing
for a failed gate is owned by [`user-execution-scenario`](../skills/user-execution-scenario/SKILL.md), and
no route from it ends in `status: done`.

## Completion Steps

Completion is a single atomic act, not a sequence that usually finishes:

1. **Update frontmatter** — set `status: done` and add `completed: YYYY-MM-DD` to the Task
   file's frontmatter. For items that will not be implemented, use `status: wontfix`, `skipped`,
   or `superseded`; every terminal status requires the date.
2. **Move the file** — `git mv .agents/tasks/<file>.md .agents/tasks/completed/<file>.md`.
   Always `git mv`, never `cp` — the root must be left with no duplicate.
3. **Update declaring initiatives** — for every AGREEMENT Task whose `children` includes this Task,
   update both its `## Children` row and its paired spec `## Tasks` row to the exact new status and
   canonical path. Authored Plan and Completion Criteria are not lifecycle projections.
4. **Single commit** — the frontmatter update, move, and all declaring-initiative projection updates
   land in the SAME commit. Do not commit or push before all are staged together.

Recovery when only one half lands, and what to do when the move conflicts, are routing owned by
[`backlog-execution-orchestrator`](../skills/backlog-execution-orchestrator/SKILL.md).

### Status Invariants

- Frontmatter `status:` is the **only** place status is recorded. Body sections such as
  `## Status` are banned and must not be written.
- A file may not reside in `completed/` with `status: todo`, `status: in-progress`, or `status: blocked`.
- A file may not have `status: done` while still in the `backlog/` root.
- `status: done` must not be set before the User Execution Test Scenario gate passes (Stage 2).
- `wontfix`, `skipped`, and `superseded` are valid terminal statuses for items that were
  deliberately not implemented; every terminal status requires `completed: YYYY-MM-DD`.
- A paired `type: AGREEMENT` Task must declare non-empty unique `children`; its Task/spec lifecycle
  rows must match every child, and `status: done` requires every child to be exactly `done`.
- Closing the loop (evidence, status, move, gates) happens in the SAME change as the work. A "tracked
  as follow-on" claim must name an existing backlog/task file.
- **Mechanized:** the `backlog-placement` scan (`scripts/harness/check-backlog-placement.mjs`, in
  `pnpm harness:scan`) fails on a terminal-status file in the root, an open-status file in
  `completed/`, or any terminal status without a valid `completed:` date. The `task-archival` scan
  additionally validates AGREEMENT child projections and fails a fully-checked task file whose spec
  never reached `spec-docs/done/` (gates overdue). These
  invariants held only as prose until they were mechanized, and the sweep that mechanized them found
  eight shipped items with stale placement.

## Base Branch Workflow

For a multi-backlog initiative: the initiative gets a base branch cut from `develop`, each backlog gets
a child branch and a PR into that base, and a final PR goes from the base into `develop`. A child PR
merges into the base only after its checks pass **and its content matches its recommendation gate** —
green checks alone do not authorize the merge. **The final PR is never auto-merged — that decision is
the user's.**

The ordering, the drift handling, and the failure edges are owned by
[`multi-backlog-initiative`](../skills/multi-backlog-initiative/SKILL.md).

## Owner Boundaries

Backlog implementation preserves the repo's owner boundaries; this rule does not own them.

- Package/tier ownership (which layer implements which kind of behaviour) —
  [`.agents/project-structure.md`](../project-structure.md) § Implementation Owner Boundaries.
- Orchestration-skill thinness (what a pipeline skill may and may not absorb) —
  [enforcement-architecture.md](enforcement-architecture.md) § An orchestration skill stays thin.

## Stop Conditions

Each condition below halts the work. They hold whether or not a pipeline is running; the orchestration
skills treat them as terminate edges and do not restate them.

- No recommendation gate was presented for the backlog or work unit.
- The recommendation was acted on without an independent `ENDORSE`, or with the verdict unrecorded.
- A required runnable user-facing backlog lacks a user execution test scenario section.
- A user execution test scenario is abstract, lacks exact commands/UI steps, or lacks expected
  observable results.
- A scenario uses engineering/governance verification (static review, tests, harness commands, CI
  checks, source or document inspection) instead of a product surface — see the authoritative
  statement in the Done Gate.
- The required test environment for the user execution test scenario is missing and was neither built,
  proposed, nor decided with the user.
- The gate was not executed when the agent reasonably could, has no captured evidence, or the
  observed evidence was not recorded back into the backlog item.
- The backlog status was set to `done` before both Done Gate stages passed (done-gate violation),
  or the gate fails / cannot be mapped to the completed behavior.
- The recommendation conflicts with repo rules, layering, package ownership, or backlog intent.
- The work would combine unrelated backlogs into one PR.
- The final initiative PR would be auto-merged into `develop`.
- An orchestration skill duplicates implementation details from invoked skills instead of only
  coordinating them.

### Combined conversion and implementation lifecycle

This procedure permits one eligible Issue-to-Task conversion and its implementation to share one ordered
topic-branch PR. This is limited to a single-cause enhancement with explicit recommendation evidence;
the Task marker/read-back, priority removal, PLAN checkpoint, implementation ordering, review, CI,
merge verification, and Issue writeback remain separate fail-closed gates. Other work-kind, security,
data-correctness, user-decision, multi-owner, and contract-owned work remains on its existing route.
Case: [PROC-017](https://github.com/woojubb/robota/issues/2514).
Enforced by: `scan-user-execution-plan-order.mjs` consumes the Task's conversion evidence and the
existing gate/branch guards enforce the remaining lifecycle boundaries.
