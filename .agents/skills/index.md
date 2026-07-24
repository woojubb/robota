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
| [post-implementation-checklist](post-implementation-checklist/SKILL.md)   | Router: mandatory post-implementation order + gates (SPEC sync → build/test → README → PR → publish → docs)                    |
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
| [architecture-conformance-audit](architecture-conformance-audit/SKILL.md) | Thin router: conformance audit = mechanical conformance scan + the architecture-refresh agent loop (GATE-CONFORMANCE)                                                                        |
| [design-quality-audit](design-quality-audit/SKILL.md)                     | Pointer stub → the `architecture-auditor` agent owns the design-quality judgement natively                                                                                                   |
| [dependency-graph-extraction](dependency-graph-extraction/SKILL.md)       | Extracts the actual workspace-internal dependency edge set + runs the mechanical conformance guards                                                                                          |
| [doc-claim-verification](doc-claim-verification/SKILL.md)                 | Pointer stub → the `architecture-conformance-auditor` agent emits per-claim doc↔code verdicts natively                                                                                       |
| [conformance-finding-report](conformance-finding-report/SKILL.md)         | Pointer stub → the `architecture-conformance-auditor` agent returns classified findings + ACTIONABLE FINDINGS natively                                                                       |
| [improvement-proposal-authoring](improvement-proposal-authoring/SKILL.md) | Maps findings to remediation + follow-up backlogs + mechanical-guard recommendations                                                                                                         |

### Spawnable Agents

Each agent's full policy lives in its definition file (`.claude/agents/<name>.md`); the pipelines
that sequence them are registered in [`orchestration-map.md`](../specs/orchestration-map.md) (SSOT
for orchestrator/worker/guardian wiring). One-line roles:

| Agent                              | Role                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `architecture-auditor`             | Read-only design-quality audit by universal principles                    |
| `architecture-conformance-auditor` | Read-only doc↔code sync audit (doc-side / code-side findings)             |
| `architecture-fixer`               | Applies doc-side findings (edits docs only)                               |
| `architecture-implementer`         | Applies code-side findings (edits code, build/tests green)                |
| `proposal-reviewer`                | Skeptical sign-off on a change proposal (ENDORSE/REVISE/REJECT)           |
| `merge-verifier`                   | Confirms a merge/PR truly landed on the remote target                     |
| `capability-scout`                 | Proposes the role decomposition for a described workflow                  |
| `prior-art-researcher`             | Research worker: prior-art block + evidence-based recommendation          |
| `agent-skill-author`               | Authors agent/skill files from an ENDORSE'd decomposition                 |
| `pr-review-reviewer`               | PR-review guardian: MUST/SHOULD/CONSIDER/NIT + `ACTIONABLE FINDINGS: <n>` |
| `pr-review-writer`                 | Posts the reviewer's findings to the PR via `gh`                          |
| `pr-review-fixer`                  | Applies minimal verified fixes for MUST/SHOULD findings                   |
| `doc-auditor`                      | Read-only documentation staleness/quality audit                           |
| `doc-fixer`                        | Applies doc findings (edits docs only, verify-before-write)               |

The **agent-definition convention** they follow is a document-type contract in
[`document-standards/index.md`](../specs/document-standards/index.md), mechanically enforced by
`pnpm harness:scan` → `agent-def-convention`.

## Documentation

| Skill                                                   | Description                                                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [documentation-refresh](documentation-refresh/SKILL.md) | Thin pipeline that re-calls doc-auditor→doc-fixer until an audit round is clean (agents hold all policy) |

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
| [pnpm-monorepo-build](pnpm-monorepo-build/SKILL.md) | pnpm build gotchas: lifecycle pre/post silence + surgical workspace-dep lockfile edits          |
| [harness-governance](harness-governance/SKILL.md)   | Rule-skill consistency, undefined terminology, mechanical checks                                |
| [lesson-to-harness](lesson-to-harness/SKILL.md)     | Mine repeated user corrections → approve → institutionalize as neutral repo rules + enforcement |
| [branch-guard](branch-guard/SKILL.md)               | Pointer: protected-branch policy lives in git-branch.md; hook + husky are the mechanical SSOT   |
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
