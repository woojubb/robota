# Skills Index

Procedural workflows and domain-specific rules for the Robota monorepo.
Parent: [AGENTS.md](../../AGENTS.md)

Consult the relevant skill before starting work in its domain. Each entry links directly to the skill file.

## Process & Planning

| Skill                                                                       | Description                                                                                                                                                                                                            |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [backlog-pipeline](backlog-pipeline/SKILL.md)                               | Spec document gate pipeline orchestrator: draft → backlog → todo → active → done                                                                                                                                       |
| [backlog-writer](backlog-writer/SKILL.md)                                   | Author a new spec document with all required sections and frontmatter                                                                                                                                                  |
| [user-request-gate](user-request-gate/SKILL.md)                             | Entry-point gate: backlog draft first, then implementation — invoked on every user impl request                                                                                                                        |
| [spec-first-development](spec-first-development/SKILL.md)                   | Enforce spec-first workflow before touching contract boundaries                                                                                                                                                        |
| [spec-writing-standard](spec-writing-standard/SKILL.md)                     | Required sections and quality gates for SPEC.md authoring                                                                                                                                                              |
| [spec-code-conformance](spec-code-conformance/SKILL.md)                     | Verification loop to align code with spec after spec changes                                                                                                                                                           |
| [tdd-red-green-refactor](tdd-red-green-refactor/SKILL.md)                   | Kent Beck TDD cycle: Red → Green → Refactor                                                                                                                                                                            |
| [task-tracking](task-tracking/SKILL.md)                                     | Create and update task files in `.agents/tasks/`                                                                                                                                                                       |
| [track-work-run](track-work-run/SKILL.md)                                   | Measure every topic work run from claim through first PR and authorized post-PR rework                                                                                                                                 |
| [find-to-issue](find-to-issue/SKILL.md)                                     | File a mid-task finding as a GitHub issue and keep going — filing is not authorization                                                                                                                                 |
| [github-issue-triage](github-issue-triage/SKILL.md)                         | Enforce Issue intake labels, audit and triage the pre-Task queue, finalize one-way Task handoff, and reconcile live labels without deletion                                                                            |
| [issue-to-backlog](issue-to-backlog/SKILL.md)                               | Convert a filed issue into the Task(s) it actually is, grouped by cause rather than by item count                                                                                                                      |
| [backlog-execution-orchestrator](backlog-execution-orchestrator/SKILL.md)   | One backlog item end to end: recommendation gate → scenario plan → implement → done gate → completion, with per-phase routing                                                                                          |
| [user-execution-scenario](user-execution-scenario/SKILL.md)                 | Scenario lifecycle in two modes — PLAN (author + written-stage gate) and GATE (execute + executed-stage gate), with bounded redesign                                                                                   |
| [multi-backlog-initiative](multi-backlog-initiative/SKILL.md)               | Outer loop for an initiative: base branch → one item pipeline per backlog → final PR left unmerged for the user                                                                                                        |
| [post-implementation-checklist](post-implementation-checklist/SKILL.md)     | Router: mandatory post-implementation order + gates (SPEC sync → build/test → README → PR → publish → docs)                                                                                                            |
| [delegated-refactor-green-gate](delegated-refactor-green-gate/SKILL.md)     | Route-only: specify → focused worker verification → one integrated gate and independent batch review → batch commit                                                                                                    |
| [worktree-parallel-orchestration](worktree-parallel-orchestration/SKILL.md) | Run ≥2 independent backlog items in parallel via worktree-isolated subagents with zero merge conflicts (partition → spawn → serial merge)                                                                              |
| [worktree-traffic-control](worktree-traffic-control/SKILL.md)               | The two gates around any worktree-isolated work — entry gate before the first command, exit gate before the work leaves                                                                                                |
| [repo-change-loop](repo-change-loop/SKILL.md)                               | Standard change loop: impact → build → verify → summarize                                                                                                                                                              |
| [pr-finding-resolution-loop](pr-finding-resolution-loop/SKILL.md)           | RESOLVE loop: local review once, before the PR exists, then resolve what the PR's review automation reported, until `ACTIONABLE FINDINGS: 0` (progress-detection escape only), then the gated merge path (HARNESS-018) |
| [automated-review-convergence](automated-review-convergence/SKILL.md)       | Iterate on a PR's automated review feedback until it converges: fetch findings → judge → fix/refute → push → re-read the re-run round                                                                                  |
| [post-merge-cycle](post-merge-cycle/SKILL.md)                               | Shared post-merge tail: verify the landing → delete the merged branch → reset onto a fresh base, with a defined edge per failure                                                                                       |
| [version-management](version-management/SKILL.md)                           | Coordinated version bumps with changesets across all packages + semver impact of public API surface changes                                                                                                            |

## Release

Nested release pipeline (HARNESS-049): the top-level orchestrator sequences three phase skills, which
share one gate-observation loop and dispatch the `ci-failure-triager` / `merge-verifier` agents. All
release invariants stay in [publish.md](../rules/publish.md); these skills carry only control flow.

| Skill                                                   | Description                                                                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [release-orchestration](release-orchestration/SKILL.md) | Top-level release state machine: source-stabilization → version-bump → npm-otp-publish, with per-phase advance/retry/regress/halt |
| [source-stabilization](source-stabilization/SKILL.md)   | Phase 1 — get the source branch green and verified as landed on the release target                                                |
| [version-bump](version-bump/SKILL.md)                   | Phase 2 — cut from a fresh base, apply the coordinated bump, land the bump PR cleanly                                             |
| [npm-otp-publish](npm-otp-publish/SKILL.md)             | Phase 3 — ordered publish preflight, the hard halt for the user's OTP, publish, and post-publish verification                     |
| [ci-gate-watch](ci-gate-watch/SKILL.md)                 | Shared observation loop for a long-running gate: observe → report the current step → route; terminates its own watcher            |

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
| [architecture-refresh](architecture-refresh/SKILL.md)                     | Outer architecture loop: separate conformance + four-dimension fanout → draft/final synthesis → verify → depth → reconcile/apply → re-audit                                                  |
| [architecture-audit-fanout](architecture-audit-fanout/SKILL.md)           | Thin bounded coverage loop for mutually blind structure/design/runtime/gate auditors; returns raw reports and never synthesizes findings                                                     |
| [capability-extraction](capability-extraction/SKILL.md)                   | Thin pipeline that sequences capability-scout→proposal-reviewer→agent-skill-author, gating authoring on ENDORSE and convergence on the `agent-def-convention` guard (agents hold all policy) |
| [architecture-conformance-audit](architecture-conformance-audit/SKILL.md) | Thin router: conformance audit = mechanical conformance scan + the architecture-refresh agent loop (GATE-CONFORMANCE)                                                                        |
| [design-quality-audit](design-quality-audit/SKILL.md)                     | Pointer stub → structure/design/runtime/gate auditors own design-quality judgement through architecture-audit-fanout                                                                         |
| [doc-claim-verification](doc-claim-verification/SKILL.md)                 | Pointer stub → the `architecture-conformance-auditor` agent emits per-claim doc↔code verdicts natively                                                                                       |
| [conformance-finding-report](conformance-finding-report/SKILL.md)         | Pointer stub → the `architecture-conformance-auditor` agent returns classified findings + ACTIONABLE FINDINGS natively                                                                       |
| [improvement-proposal-authoring](improvement-proposal-authoring/SKILL.md) | Maps findings to remediation + follow-up backlogs + mechanical-guard recommendations                                                                                                         |

### Spawnable Agents

Each agent's full policy lives in its definition file (`.claude/agents/<name>.md`); the pipelines
that sequence them are registered in [`orchestration-map.md`](../specs/orchestration-map.md) (SSOT
for orchestrator/worker/guardian wiring). One-line roles:

| Agent                              | Role                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `architecture-structure-auditor`   | Read-only structure audit with target×criterion coverage (`AUDIT-DIM-COMPLETE`)                            |
| `architecture-design-auditor`      | Read-only contract/interface design audit with target×criterion coverage (`AUDIT-DIM-COMPLETE`)            |
| `architecture-runtime-auditor`     | Read-only lifecycle/concurrency/error/resource audit with target×criterion coverage (`AUDIT-DIM-COMPLETE`) |
| `architecture-gate-auditor`        | Read-only contract-to-test and gate-strength audit with target×criterion coverage (`AUDIT-DIM-COMPLETE`)   |
| `architecture-conformance-auditor` | Read-only, separate doc↔code sync audit (doc-side / code-side findings)                                    |
| `architecture-audit-synthesizer`   | Read-only draft deduplication/cross-dimension judgement and final verifier application (`SYNTH`)           |
| `finding-verifier`                 | Read-only adversarial truth test for one isolated finding (`VERIFY`)                                       |
| `finding-depth-triager`            | Guardian: judges a finding LOCAL / FOUNDATIONAL / INVALID / UNDETERMINED (`DEPTH:`)                        |
| `finding-reconciler`               | Read-only sole registry matcher for an already-FOUNDATIONAL finding (`RECONCILE`)                          |
| `architecture-fixer`               | Applies doc-side findings (edits docs only)                                                                |
| `architecture-implementer`         | Applies code-side findings (edits code, build/tests green)                                                 |
| `proposal-reviewer`                | Skeptical sign-off on a change proposal (ENDORSE/REVISE/REJECT)                                            |
| `merge-verifier`                   | Confirms a merge/PR truly landed on the remote target                                                      |
| `capability-scout`                 | Proposes the role decomposition for a described workflow                                                   |
| `prior-art-researcher`             | Research worker: prior-art block + evidence-based recommendation                                           |
| `agent-skill-author`               | Authors agent/skill files from an ENDORSE'd decomposition                                                  |
| `pr-review-reviewer`               | PR-review guardian: MUST/SHOULD/CONSIDER/NIT + `ACTIONABLE FINDINGS: <n>`                                  |
| `pr-review-writer`                 | Posts the reviewer's findings to the PR via `gh`                                                           |
| `pr-review-fixer`                  | Applies minimal verified fixes for MUST/SHOULD findings                                                    |
| `doc-auditor`                      | Read-only documentation staleness/quality audit                                                            |
| `doc-fixer`                        | Applies doc findings (edits docs only, verify-before-write)                                                |
| `ci-failure-triager`               | Read-only CI/gate triage: one failure class + the five-field triage note                                   |
| `backlog-gate-guard`               | Gate guardian: one gate, one document → `GATE VERDICT: PASS/FAIL/NON-COMPLIANCE`                           |
| `wiring-worker`                    | Wires an authored artifact into every touchpoint; produces only, issues no verdict                         |
| `wiring-guardian`                  | Judges wiring AND whether the registration check could have gone red (`GATE VERDICT`)                      |
| `worktree-entry-gate`              | Before work starts in a worktree → `GATE VERDICT: PASS/FAIL/NON-COMPLIANCE`                                |
| `worktree-exit-gate`               | Before work leaves a worktree → `GATE VERDICT: PASS/FAIL/NON-COMPLIANCE`                                   |
| `user-execution-scenario-author`   | Authors user-execution scenarios → `SCENARIO DRAFTED: <mode> \| <count>`                                   |
| `mechanical-refactor-worker`       | Executes one specified mechanical change to green, or reports the exact blocker                            |

The **agent-definition convention** they follow is a document-type contract in
[`document-standards/index.md`](../specs/document-standards/index.md), mechanically enforced by
`pnpm harness:scan` → `agent-def-convention`.

## Documentation

| Skill                                                   | Description                                                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [documentation-refresh](documentation-refresh/SKILL.md) | Thin pipeline that re-calls doc-auditor→finding-depth-triager→doc-fixer until every finding of a round is RESOLVED (agents hold all policy) |

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

| Skill                                                 | Description                                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [pnpm-monorepo-build](pnpm-monorepo-build/SKILL.md)   | pnpm build gotchas: lifecycle pre/post silence + surgical workspace-dep lockfile edits          |
| [harness-governance](harness-governance/SKILL.md)     | Rule-skill consistency, undefined terminology, mechanical checks                                |
| [lesson-to-harness](lesson-to-harness/SKILL.md)       | Mine repeated user corrections → approve → institutionalize as neutral repo rules + enforcement |
| [wiring-orchestration](wiring-orchestration/SKILL.md) | Thin: wiring-worker → wiring-guardian, routes on the verdict; holds no wiring policy            |
| [contract-disposition](contract-disposition/SKILL.md) | Decide an unconsumed/immovable contract's fate from its ACTUAL state, not a proxy signal        |
| [branch-guard](branch-guard/SKILL.md)                 | Pointer: protected-branch policy lives in git-branch.md; hook + husky are the mechanical SSOT   |

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
