# AGENTS.md — Robota Monorepo Agent Guidelines

This file is the control plane for AI agents working in the Robota monorepo.

It defines:

- non-negotiable rules
- ownership boundaries
- verification expectations
- how skills must be used
- how Robota is moving toward a full harness model

This file is intentionally concise. It is not the place for long tutorials, repeated architecture essays, or duplicated package-specific knowledge.

## Project Overview

Robota is a TypeScript/JavaScript monorepo for building AI agents with multi-provider support (OpenAI, Anthropic, Google AI). It uses a pnpm workspace with strict TypeScript, ESLint, and a DAG-based orchestration system.

- Package manager: `pnpm` 8.15.4
- Node.js: 22.14.0 (Volta), minimum 18.0.0
- Module system: ES modules only (`"type": "module"`)
- Repository: <https://github.com/woojubb/robota.git>

## Harness Operating Model

Robota is adopting a harness-first workflow.

This means:

- rules define hard constraints and ownership
- skills define repeatable task workflows
- owner documents define domain truth
- scripts, lint, tests, and verification flows enforce important invariants mechanically
- workspace scope discovery follows `pnpm-workspace.yaml`

Agents must prefer:

1. repository-approved commands
2. explicit verification loops
3. owner-defined contracts
4. narrow, verifiable changes

Agents must avoid:

- inventing local conventions not owned by the repository
- relying on memory instead of repository guidance
- treating prose as a substitute for build, test, and verification

## Common Commands

```bash
pnpm install
pnpm build
pnpm build:deps
pnpm --filter @robota-sdk/<pkg> build
pnpm test
pnpm typecheck
pnpm lint
pnpm docs:build
```

## Project Structure

```text
packages/
├── agents/             # Core agent functionality
├── anthropic/          # Anthropic provider
├── openai/             # OpenAI provider
├── google/             # Google provider
├── sessions/           # Session management
├── team/               # Team collaboration
├── workflow/           # Workflow visualization/events
├── playground/         # Playground UI package
├── remote/             # Remote execution package
├── dag-core/           # DAG domain contracts and state rules (SSOT)
├── dag-runtime/        # DAG orchestration runtime
├── dag-worker/         # DAG worker execution layer
├── dag-scheduler/      # DAG scheduler layer
├── dag-projection/     # DAG projection/read-model layer
├── dag-api/            # DAG API/composition layer
├── dag-designer/       # DAG web designer layer
└── dag-nodes/          # DAG node implementations
apps/
├── web/                # Web application
├── docs/               # Documentation site
└── api-server/         # API server
```

### DAG Dependency Direction (Mandatory)

- `dag-core` is the SSOT contract package for all DAG packages.
- All other dag packages (`dag-runtime`, `dag-worker`, `dag-scheduler`, `dag-projection`, `dag-api`, `dag-designer`) depend on `dag-core`.
- `dag-designer` must NOT import runtime, worker, or scheduler implementations directly.

## Mandatory Rules

All rules below are mandatory and non-negotiable.

### Language Policy

- Code and comments: English only.
- Conversations with the user: Korean only.
- Documents in `.design/`: Korean only.
- Documents in all other folders: English only.
- Commit messages: English only and conventional commits format.

### Type System (Strict)

- TypeScript strict mode is immutable and must never be disabled.
- `any` and `{}` are prohibited in production code.
- `unknown` is allowed only at trust boundaries and `catch` boundaries, and must be narrowed before domain use.
- `// @ts-ignore` and `// @ts-nocheck` are prohibited.
- `I*` prefix is for interfaces only. `T*` prefix is for type aliases only.
- Type aliases with `I*` prefix or interfaces with `T*` prefix are naming violations. Rename to match the convention.
- In test files (`*.test.ts`, `*.spec.ts`), `any` and `unknown` may be used only for mocks or boundary fixtures.
- Follow owner-based SSOT: every concept has exactly one owner module. Import from the owner's public surface and never re-declare owned contracts.
- Trivial 1:1 type aliases (`type X = Y`) that add no semantic value are prohibited. Use the original type directly. Generic specializations (`type X = Map<string, Foo>`) and discriminated unions are allowed.

### No Fallback Policy

- Fallback logic is prohibited. There must be a single, correct, verifiable path.
- No `try/catch` that silently switches to alternative implementations.
- No logical OR fallbacks for core behavior (`primary() || fallback()`).
- Terminal failure states (`failed`, `cancelled`) must remain terminal by default.
- Retry or requeue is allowed only through an explicit policy gate, never as an implicit fallback.

### Test-Driven Development

- Follow Kent Beck's Red-Green-Refactor cycle when writing new code or modifying behavior.
- RED: write a failing test first. GREEN: write minimal code to pass. REFACTOR: clean up while green.
- Never write production code without a failing test that demands it.
- Never refactor while tests are failing.
- Never add behavior during refactoring — only restructure.
- Bug fixes start with a test that reproduces the bug.
- Prefer small, incremental steps. If a step feels too big, break it down.

### Build Requirements

- ANY modification to `packages/*/src/` REQUIRES immediate build of the affected scope.
- Never skip builds after package source changes.
- Never commit code that does not build successfully.
- Mandatory loop: change -> build -> targeted test or smoke test -> fix -> re-verify.
- If a change affects execution paths, scenarios, or examples, run the relevant verification flow and stop on strict-policy failures.

### Import Standards

- Static ES module imports at the top of files are the default.
- NEVER use `await import()` in the middle of functions for required modules.
- Dynamic import is allowed only for optional modules with explicit ownership and explicit error handling.

### Development Patterns

- NEVER use `console.*` directly in production code.
- ALWAYS use dependency injection for logging and side concerns.
- No temporary workarounds, dummy data, or type tricks to bypass builds or verification.
- No blind type assertions (`as any`, `as unknown as T`, unchecked `as T` for external data) without proper validation.
- Separate core behavior from side concerns.
- Keep the canonical path concise once ownership is established.

### Agent Identity

- Prohibited: `main agent`, `sub-agent`, `parent-agent`, `child-agent`, and any hierarchy-implying naming.
- Approved: `agent`, `agent instance`, `agent replica`, with flat identifiers such as `agent_0`, `agent_1`.

### Styling

- Tailwind CSS utility classes only.
- No inline `style` attributes, custom CSS, or CSS-in-JS.

### Git Operations

- No `git commit` or `git push` without explicit user approval.
- Conventional commit format: `<type>(<scope>): <message>` (max 80 chars).
- Valid types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`.

### DAG Node Implementation

- Every node class must extend `AbstractNodeDefinition`.
- Config validation goes through `configSchemaDefinition` plus base-class runtime parse.
- Use `NodeIoAccessor` helpers for input validation. Do not manually read port payload keys for canonical validation paths.
- Cost computation must go through `estimateCostWithConfig(...)`.
- Validation failures use `DAG_VALIDATION_*` codes.
- Execution failures use `DAG_TASK_EXECUTION_*` codes.

### Execution Safety

- No duplicate-prevention anti-patterns. Design systems that do not generate duplicates.
- Failure layers `[EMITTER-CONTRACT]` and `[APPLY-LAYER]` both stop immediately.
- Event names must use declarative constants with correct ownership and prefix.
- DAG events use `run.*`, `task.*`, `worker.*`, and `scheduler.*` prefixes.

### Execution Caching

- ALWAYS check cache before LLM calls.
- ALWAYS save successful LLM results to cache.
- NEVER run equivalent executions repeatedly without cache utilization.
- If cache integrity validation fails, stop execution and surface the error. Do not silently fall back to a live LLM call.

## Skills Reference

Procedural workflows and implementation guides live under `.agents/skills/`.

Harness-oriented repository skills:

| Skill | Path | Purpose |
|-------|------|---------|
| repo-change-loop | `.agents/skills/repo-change-loop/` | Standard change -> build -> test -> verify workflow |
| scenario-verification-harness | `.agents/skills/scenario-verification-harness/` | Scenario pre-check, record, verify, and stop conditions |
| harness-governance | `.agents/skills/harness-governance/` | Rule/skill/owner drift checks and policy consistency |
| type-boundary-and-ssot | `.agents/skills/type-boundary-and-ssot/` | Boundary validation, type strictness, quality gates, and SSOT ownership workflow |
| repo-writing | `.agents/skills/repo-writing/` | Repository writing rules for docs, `.design/`, and commit messages |
| spec-writing-standard | `.agents/skills/spec-writing-standard/` | SPEC.md required sections, quality gates, and drift detection |

Domain and package skills:

| Skill | Path | Purpose |
|-------|------|---------|
| dag-node-standard | `.agents/skills/dag-node-standard/` | Node implementation workflow and templates |
| pnpm-monorepo-build | `.agents/skills/pnpm-monorepo-build/` | Build commands and workflow guidance |
| architecture-patterns | `.agents/skills/architecture-patterns/` | Functional core/imperative shell, ports-and-adapters, DI patterns |
| tdd-red-green-refactor | `.agents/skills/tdd-red-green-refactor/` | Kent Beck's TDD Red-Green-Refactor cycle |
| vitest-testing-strategy | `.agents/skills/vitest-testing-strategy/` | Testing strategy (unit, integration, type-level) |
| contract-testing | `.agents/skills/contract-testing/` | Consumer-driven contract testing |
| state-machine-design | `.agents/skills/state-machine-design/` | Finite state machine design patterns |
| ddd-tactical-patterns | `.agents/skills/ddd-tactical-patterns/` | DDD patterns (Aggregate, Value Object, Domain Event) |
| cqrs-event-projection-basics | `.agents/skills/cqrs-event-projection-basics/` | CQRS and event projection fundamentals |
| async-concurrency-patterns | `.agents/skills/async-concurrency-patterns/` | Concurrent async with limits and cancellation |
| effect-style-error-modeling | `.agents/skills/effect-style-error-modeling/` | Result/Either-based error modeling |
| execution-caching | `.agents/skills/execution-caching/` | Execution caching workflows |
| architecture-decision-records | `.agents/skills/architecture-decision-records/` | ADR format and workflow |
| semver-api-surface | `.agents/skills/semver-api-surface/` | Semantic versioning for monorepo |
| plugin-development | `.agents/skills/plugin-development/` | Plugin development with validation |
| robota-sdk-usage | `.agents/skills/robota-sdk-usage/` | SDK usage patterns and migration |
| tailwind-truncation | `.agents/skills/tailwind-truncation/` | Tailwind truncation patterns |
| branch-guard | `.agents/skills/branch-guard/` | Guard against committing on protected branches |
| task-tracking | `.agents/skills/task-tracking/` | Track work with task files in .agents/tasks/ |
| contract-audit | `.agents/skills/contract-audit/` | Package-level class contract review and SPEC.md registry |
| package-code-review | `.agents/skills/package-code-review/` | Systematic 6-perspective code review with severity labels |

## Rules and Skills Boundary

- Rules: mandatory constraints defined in the "Mandatory Rules" section above. Rules always win on conflict.
- Skills: procedural task harnesses under `.agents/skills/`. Skills describe execution workflow, not repository law.
- Owner documents: package docs, ADRs, contracts, and owned specs. These define domain truth and detailed contracts.
- If skill text conflicts with a rule, the rule wins.

Skills must not:

- redefine repository rules
- introduce new rule-level terminology without an owner document
- duplicate large sections of `AGENTS.md`
- teach examples that violate repository rules

When a new invariant matters repeatedly, prefer a mechanical check over adding more prose.

## Owner Knowledge Policy

Detailed domain truth should live in owner documents, package docs, ADRs, or contract definitions.

Each workspace package or app should own its current-state specification in `docs/SPEC.md`.
Each workspace `docs/README.md` should expose `SPEC.md` as the canonical entrypoint for that scope.

### Spec Quality Gate

Each workspace `docs/SPEC.md` must include at minimum:

- **Scope**: what the package owns.
- **Boundaries**: what the package does not own and where those responsibilities live.
- **Architecture Overview**: layer structure or key components.
- **Type Ownership**: SSOT types defined by this package (table: Type | Location | Purpose).
- **Public API Surface**: primary exported classes, functions, and types.
- **Extension Points**: abstract classes or interfaces that consumers implement.
- **Error Taxonomy**: package-specific error types with codes and categories.
- **Test Strategy**: current test coverage and identified gaps.
- **Class Contract Registry**: interface implementations, inheritance chains, and cross-package port consumers.

The `spec-writing-standard` skill provides the full workflow for creating or updating SPEC.md files.

### Continuous Improvement

When modifying a package, agents should:

- Check if `docs/SPEC.md` reflects the current architecture.
- Identify missing test coverage for touched code paths.
- Update type ownership documentation if new SSOT types are introduced.
- Flag SPEC.md drift for packages where implementation diverges from spec.
Each workspace that owns `examples/` or scenario artifacts should expose a package-level `scenario:verify` command.
Each workspace that owns `examples/` or scenario artifacts should expose a package-level `scenario:record` command when scenario output can be refreshed.
Each workspace that owns `examples/` or scenario artifacts should keep authoritative records under `examples/scenarios/*.record.json`.
Scenario verification should treat those `*.record.json` artifacts as the canonical drift-detection baseline.
Missing, invalid, duplicate, or command-mismatched scenario record artifacts are verification failures, not advisory notes.

Examples:

- DAG dependency contracts
- node execution contracts
- event naming contracts
- scenario formats
- cache key and invalidation contracts
- public API surface rules

`AGENTS.md` should point to these owners, not duplicate them.

## Harness Direction

Robota is adopting a full harness model.

The target state is:

- standard repository entrypoints for scan, verify, review, and cleanup
- mechanical checks for dependency direction, boundary validation, naming, and document drift
- verification-first change loops
- observable execution flows for scenario, ownerPath, and strict-policy failures

Until dedicated harness commands exist, agents must use the closest repository-approved build, test, lint, typecheck, and scenario verification commands available.

Current harness entrypoints:

- `pnpm harness:scan` (consistency + spec ownership + docs structure)
- `pnpm harness:scan:consistency`
- `pnpm harness:verify -- --scope <packages/foo|apps/bar> [--include-scenarios] [--base-ref <git-ref>]`
- `pnpm harness:record -- --scope <packages/foo|apps/bar> [--base-ref <git-ref>]`
- `pnpm harness:review -- --scope <packages/foo|apps/bar> [--report-file <path>] [--base-ref <git-ref>]`
- `pnpm harness:self-check`
- `pnpm harness:cleanup`
- `pnpm harness:bootstrap -- [--scope web|api-server] [--report-file <path>] [--dry-run]`
- `pnpm harness:run-context -- [--scope <scope>] [--report-file <path>]`

When the working tree is clean, harness commands may resolve scope from `git diff <base-ref>...HEAD` instead of `git status`.

## Conflict Scan Commands

Use these scans before merging changes to rules, skills, or owner guidance:

```bash
rg -n "any/unknown may|fallback to|temporary workaround|Path-Only" .agents/skills AGENTS.md
rg -n "main agent|sub-agent|parent-agent|child-agent" .agents/skills AGENTS.md
rg -n '^## ' AGENTS.md
```

## Code Review Focus Areas (dag-* packages)

When reviewing dag-* code, check:

1. Dependency direction: all imports flow toward `dag-core`; no cross-imports between sibling packages.
2. Type safety: no `any` or `{}` in production code; `unknown` only at boundaries with immediate narrowing.
3. SSOT compliance: types imported from the owner package; no re-declarations.
4. Node implementation: extends `AbstractNodeDefinition`, uses `NodeIoAccessor`, proper error codes.
5. No fallback patterns: single correct path, no silent alternatives.
6. Event naming: correct prefixes (`run.*`, `task.*`, `worker.*`, `scheduler.*`) and owned constants.
7. State machine integrity: terminal states remain terminal unless an explicit policy gate allows reprocessing.
8. Build verification: all changes build successfully before completion.
9. Agent identity: no hierarchy-implying naming or concepts.
10. Import standards: static imports by default; dynamic import only for explicit optional-module cases.
