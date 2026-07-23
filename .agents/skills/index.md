# Skills Index

Procedural workflows and domain-specific rules for the Robota monorepo.
Parent: [AGENTS.md](../../AGENTS.md)

Consult the relevant skill before starting work in its domain. Each entry links directly to the skill file.

## Process & Planning

| Skill                                                                     | Description                                                                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [backlog-pipeline](backlog-pipeline/SKILL.md)                             | Spec document gate pipeline orchestrator: draft → backlog → todo → active → done                                               |
| [backlog-writer](backlog-writer/SKILL.md)                                 | Author a new spec document with all required sections and frontmatter                                                          |
| [backlog-gate-guard](backlog-gate-guard/SKILL.md)                         | Validate a single gate (GATE-WRITE/APPROVAL/IMPLEMENT/VERIFY/COMPLETE) and record Evidence Log                                 |
| [user-request-gate](user-request-gate/SKILL.md)                           | Entry-point gate: backlog draft first, then implementation — invoked on every user impl request                                |
| [spec-first-development](spec-first-development/SKILL.md)                 | Enforce spec-first workflow before touching contract boundaries                                                                |
| [spec-writing-standard](spec-writing-standard/SKILL.md)                   | Required sections and quality gates for SPEC.md authoring                                                                      |
| [spec-code-conformance](spec-code-conformance/SKILL.md)                   | Verification loop to align code with spec after spec changes                                                                   |
| [tdd-red-green-refactor](tdd-red-green-refactor/SKILL.md)                 | Kent Beck TDD cycle: Red → Green → Refactor                                                                                    |
| [task-tracking](task-tracking/SKILL.md)                                   | Create and update task files in `.agents/tasks/`                                                                               |
| [backlog-execution-orchestrator](backlog-execution-orchestrator/SKILL.md) | Route-only backlog PR pipeline — sequences the gates owned by `backlog-execution.md` and routes to owner skills                |
| [post-implementation-checklist](post-implementation-checklist/SKILL.md)   | Mandatory checklist after completing implementation work                                                                       |
| [delegated-refactor-green-gate](delegated-refactor-green-gate/SKILL.md)   | Delegate a large mechanical refactor to a subagent under a hard green-or-report completion gate                                |
| [repo-change-loop](repo-change-loop/SKILL.md)                             | Standard change loop: impact → build → verify → summarize                                                                      |
| [pr-review-orchestration](pr-review-orchestration/SKILL.md)               | Route-only PR-review loop: reviewer→writer→fixer until `ACTIONABLE FINDINGS: 0` (bounded), then gated merge path (HARNESS-018) |
| [version-management](version-management/SKILL.md)                         | Coordinated version bumps with changesets across all packages + semver impact of public API surface changes                    |

## Code Quality & Architecture

| Skill                                                                   | Description                                                                        |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [architecture-patterns](architecture-patterns/SKILL.md)                 | Functional core/imperative shell, ports-and-adapters, DI composition               |
| [architecture-decision-records](architecture-decision-records/SKILL.md) | ADR format for recording significant design decisions                              |
| [architecture-map-authoring](architecture-map-authoring/SKILL.md)       | Author/update an architecture-map doc to the RULE-008 contract + completeness gate |
| [design-doc-authoring](design-doc-authoring/SKILL.md)                   | Author a component design/LLD doc to the RULE-009 contract + completeness gate     |
| [type-boundary-and-ssot](type-boundary-and-ssot/SKILL.md)               | Trust-boundary validation, SSOT type ownership                                     |
| [effect-style-error-modeling](effect-style-error-modeling/SKILL.md)     | Explicit error modeling with Result/Either patterns                                |
| [api-error-standard](api-error-standard/SKILL.md)                       | RFC 7807 Problem Details error response format                                     |

## Architecture Conformance

| Skill                                                                     | Description                                                                                                                                                                                  |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [architecture-refresh](architecture-refresh/SKILL.md)                     | Thin pipeline that re-calls architecture-auditor→architecture-fixer until an audit round is materially clean (agents hold all policy)                                                        |
| [capability-extraction](capability-extraction/SKILL.md)                   | Thin pipeline that sequences capability-scout→proposal-reviewer→agent-skill-author, gating authoring on ENDORSE and convergence on the `agent-def-convention` guard (agents hold all policy) |
| [architecture-conformance-audit](architecture-conformance-audit/SKILL.md) | Orchestrates a repeatable doc-vs-code architecture conformance audit (GATE-CONFORMANCE)                                                                                                      |
| [design-quality-audit](design-quality-audit/SKILL.md)                     | Repeatable deep design-quality audit — judges whether the design is right (vs doc conformance)                                                                                               |
| [dependency-graph-extraction](dependency-graph-extraction/SKILL.md)       | Extracts the actual workspace-internal dependency edge set + runs the mechanical conformance guards                                                                                          |
| [doc-claim-verification](doc-claim-verification/SKILL.md)                 | Verifies one architecture document's claims vs code: HOLDS/DRIFT/VIOLATION/CONTRADICTION/STALE                                                                                               |
| [conformance-finding-report](conformance-finding-report/SKILL.md)         | Assembles verdicts into the AF-NN findings report with severities + counts (INFRA-002 schema)                                                                                                |
| [improvement-proposal-authoring](improvement-proposal-authoring/SKILL.md) | Maps findings to remediation + follow-up backlogs + mechanical-guard recommendations                                                                                                         |

> **Spawnable architecture agents (they hold the policy).** For an independent review dispatchable from
> the main loop, a `/command`, a Workflow fan-out, or the `architecture-refresh` orchestrator, use four
> universal/neutral subagents (portable to any codebase; they judge by timeless design principles, not
> house style) — two read-only auditors and two appliers:
>
> - `architecture-auditor` (`.claude/agents/architecture-auditor.md`, read-only) — judges whether the
>   **design is good** by universal principles; returns severity-classified findings ending with
>   `ACTIONABLE FINDINGS: <n>`.
> - `architecture-conformance-auditor` (`.claude/agents/architecture-conformance-auditor.md`, read-only)
>   — judges whether the **design and the code are in sync** (both directions), classifying each finding
>   `doc-side` or `code-side` (HOLDS/DRIFT/VIOLATION/PHANTOM/UNDOCUMENTED); also ends with `ACTIONABLE
FINDINGS: <n>`.
> - `architecture-fixer` (`.claude/agents/architecture-fixer.md`, edits docs only) — resolves **doc-side**
>   findings: brings architecture docs/SPECs/maps in line with the code.
> - `architecture-implementer` (`.claude/agents/architecture-implementer.md`, edits code) — resolves
>   **code-side** findings: brings the code in line with the intended architecture, verified (build/tests
>   green), following the repo's change process; stops-and-plans when a change is too large to make safely.
>
> Spawn via the Agent tool / Workflow `agentType` (available after a session restart once committed). The
> `architecture-refresh` skill is only the loop that sequences them.

> **Spawnable review, verification & discovery agents (they hold the policy).** Three more
> universal/neutral subagents, each ending its output with a terminal machine-signal so an orchestration
> loop can react mechanically:
>
> - `proposal-reviewer` (`.claude/agents/proposal-reviewer.md`, read-only) — skeptical outside sign-off
>   on a change proposal / spec decision; ends with `REVIEW VERDICT: <ENDORSE|REVISE|REJECT>`.
> - `merge-verifier` (`.claude/agents/merge-verifier.md`, read-only) — confirms a merge/PR truly landed
>   on its target's remote head; ends with `MERGE VERIFIED: <PASS|FAIL>`.
> - `capability-scout` (`.claude/agents/capability-scout.md`, read-only) — proposes the role
>   decomposition for a described workflow (which roles → agents vs thin-skill steps, sequencing,
>   per-role signal, tool scope) and flags over-scoped/duplicate roles; ends with `DECOMPOSITION: <n>
roles …`. It is the discovery specialization `lesson-to-harness` dispatches for a "new recurring role."
> - `prior-art-researcher` (`.claude/agents/prior-art-researcher.md`, read-only) — the research **WORKER**:
>   given a spec topic, researches comparable products / OSS / AI-agent references from PRODUCT DOCS (not
>   source code) and returns a ready-to-paste `## Prior Art Research` block + evidence-based recommendation;
>   ends with `PRIOR_ART_RESEARCH: <FOUND|NONE_FOUND>`. Dispatched by `user-request-gate` (default-on per
>   `research.md`); its output is judged by the `backlog-gate-guard` GATE-WRITE research criterion (guardian)
>   and floored by `scan-spec-research.mjs`.
> - `agent-skill-author` (`.claude/agents/agent-skill-author.md`, edit-capable) — the **write-side**:
>   authors/edits the agent/skill files from an ENDORSE'd decomposition, to the agent-definition
>   convention; its completion evidence is a green `agent-def-convention` guard (it declares no `signal:`
>   field, like `architecture-implementer`). The `capability-extraction` skill sequences
>   scout → `proposal-reviewer` → author → guard.
> - `pr-review-reviewer` (`.claude/agents/pr-review-reviewer.md`, read-only) — the PR-review **guardian**
>   (HARNESS-018): applies `/code-review` (MUST/SHOULD/CONSIDER/NIT) to a PR and ends with
>   `ACTIONABLE FINDINGS: <n>` (unresolved MUST+SHOULD). Judges only — never edits/posts/fixes.
> - `pr-review-writer` (`.claude/agents/pr-review-writer.md`, worker) — posts the reviewer's findings to the
>   PR via `gh` as a durable artifact; produces only, no judgment, touches no repo files.
> - `pr-review-fixer` (`.claude/agents/pr-review-fixer.md`, edit-capable) — applies minimal verified fixes for
>   the reviewer's MUST/SHOULD findings on the PR branch; never emits the verdict (re-review is the reviewer's).
>   The `pr-review-orchestration` skill sequences reviewer → writer → fixer → re-review to convergence
>   (`ACTIONABLE FINDINGS: 0`), bounded, then the gated merge path.
>
> The **agent-definition convention** these agents follow (frontmatter `name`/`description`/`tools`,
> read-only tool-scope, a closed-vocabulary terminal `signal:`, index registration) is a document-type
> contract in [`document-standards/index.md`](../specs/document-standards/index.md) and is mechanically
> enforced by `scripts/harness/check-agent-def-convention.mjs` (`pnpm harness:scan` →
> `agent-def-convention`).

## Documentation

| Skill                                                   | Description                                                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [documentation-refresh](documentation-refresh/SKILL.md) | Thin pipeline that re-calls doc-auditor→doc-fixer until an audit round is clean (agents hold all policy) |

> **Spawnable doc agents (they hold the policy).** The refresh skill is only the loop; the judgement
> and roles live in two universal/neutral subagents (portable to any codebase; they judge docs against
> the code, not house style): `doc-auditor`
> (`.claude/agents/doc-auditor.md`, read-only — enumerates every doc in scope, returns per-file
> findings + an `ACTIONABLE FINDINGS` convergence signal) and `doc-fixer`
> (`.claude/agents/doc-fixer.md`, edits docs only — applies a findings list, verify-before-write).
> Spawn via the Agent tool / Workflow `agentType` `doc-auditor` / `doc-fixer` (available after a
> session restart once committed).

## Testing

| Skill                                                                   | Description                                                                                  |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [vitest-testing-strategy](vitest-testing-strategy/SKILL.md)             | Practical unit, integration, and type-level testing with Vitest                              |
| [pre-refactor-test-harness](pre-refactor-test-harness/SKILL.md)         | Characterization tests before refactoring monolithic files                                   |
| [contract-testing](contract-testing/SKILL.md)                           | Consumer-driven contract testing for API boundaries                                          |
| [framework-functional-testing](framework-functional-testing/SKILL.md)   | Functionally verify a feature via a real InteractiveSession (scripted provider), not the CLI |
| [scenario-verification-harness](scenario-verification-harness/SKILL.md) | Verify a change against a recorded scenario (generic verify/re-record loop)                  |
| [contract-audit](contract-audit/SKILL.md)                               | Class contract registry audit and SPEC.md update                                             |

## Build & Repository

| Skill                                               | Description                                                                                     |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [pnpm-monorepo-build](pnpm-monorepo-build/SKILL.md) | pnpm workspace build commands and order                                                         |
| [harness-governance](harness-governance/SKILL.md)   | Rule-skill consistency, undefined terminology, mechanical checks                                |
| [lesson-to-harness](lesson-to-harness/SKILL.md)     | Mine repeated user corrections → approve → institutionalize as neutral repo rules + enforcement |
| [branch-guard](branch-guard/SKILL.md)               | Guard against direct commits to protected branches                                              |
| [daily-report](daily-report/SKILL.md)               | Generate the committed daily work report (OBSERVABILITY-001) — one summary per UTC work day     |

## Package-Specific

| Skill                                               | Description                                                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [api-spec-management](api-spec-management/SKILL.md) | API specification management for external-facing endpoints                                                  |
| [package-code-review](package-code-review/SKILL.md) | Six-perspective code review: correctness, architecture, type safety, security, performance, maintainability |

## Frontend & UI

| Skill                                                               | Description                                                |
| ------------------------------------------------------------------- | ---------------------------------------------------------- |
| [vercel-react-best-practices](vercel-react-best-practices/SKILL.md) | React/Next.js performance patterns from Vercel Engineering |
| [vercel-composition-patterns](vercel-composition-patterns/SKILL.md) | React composition patterns                                 |
