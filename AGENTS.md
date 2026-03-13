# AGENTS.md — Robota Monorepo Agent Guidelines

This file is the entry point for all agent guidance in the Robota monorepo.

## Document Discovery Policy

This file contains only domain-free rules and routing. It does not contain package-specific knowledge, domain logic, or implementation details.

**Progressive discovery model:**

1. **Start here.** Read this file for non-negotiable rules and document routing.
2. **Follow links.** For domain details, follow the references to skills, specs, or structure documents.
3. **Dig into packages.** For package-specific contracts, read `packages/<name>/docs/SPEC.md`.

**Principles:**

- This file must remain domain-free. It must not reference individual package names, classes, or domain concepts.
- Domain-specific rules belong in skills (`.agents/skills/`) or package specs (`docs/SPEC.md`).
- Never duplicate content across levels. Each fact has exactly one owner document.
- Intermediate index files (e.g., `.agents/project-structure.md`) may be introduced to group and route to related documents when the tree grows deep.
- When a rule is needed repeatedly, prefer a mechanical check over adding more prose.

**Document tree:**

```
AGENTS.md                              ← rules + routing (this file)
├── .agents/project-structure.md       ← package listing and dependency rules
├── .agents/skills/*/SKILL.md          ← procedural workflows and domain rules
│   ├── branch-guard/                  ← branch, merge, worktree, deploy procedures
│   ├── dag-node-standard/             ← DAG node implementation and execution safety
│   ├── execution-caching/             ← cache-first execution rules
│   ├── package-code-review/           ← review perspectives and domain checklists
│   ├── spec-writing-standard/         ← SPEC.md quality gates
│   └── ...                            ← see Skills Reference below
├── .agents/tasks/                     ← active and completed task tracking
├── packages/*/docs/SPEC.md            ← package-level contracts (SSOT)
└── .design/                           ← design documents (Korean)
```

## Project Overview

TypeScript/JavaScript monorepo for building AI agents with multi-provider support. Uses a pnpm workspace with strict TypeScript and ESLint.

- Package manager: `pnpm` 8.15.4
- Node.js: 22.14.0 (Volta), minimum 18.0.0
- Module system: ES modules only (`"type": "module"`)
- Repository: <https://github.com/woojubb/robota.git>

## Project Structure

See [`.agents/project-structure.md`](.agents/project-structure.md) for the full package and app listing, including dependency direction rules.

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

## Harness Entrypoints

```bash
pnpm harness:scan
pnpm harness:verify -- --scope <packages/foo|apps/bar> [--include-scenarios] [--base-ref <git-ref>]
pnpm harness:record -- --scope <packages/foo|apps/bar> [--base-ref <git-ref>]
pnpm harness:review -- --scope <packages/foo|apps/bar> [--report-file <path>] [--base-ref <git-ref>]
pnpm harness:self-check
pnpm harness:cleanup
pnpm harness:bootstrap -- [--scope web|api-server] [--report-file <path>] [--dry-run]
pnpm harness:run-context -- [--scope <scope>] [--report-file <path>]
```

## Mandatory Rules

All rules below are mandatory, non-negotiable, and domain-free. Domain-specific rules live in skills and specs.

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
- `I*` prefix is for interfaces only. `T*` prefix is for type aliases only. Type aliases with `I*` prefix or interfaces with `T*` prefix are naming violations and must be renamed.
- In test files (`*.test.ts`, `*.spec.ts`), `any` and `unknown` may be used only for mocks or boundary fixtures.
- Follow owner-based SSOT: every concept has exactly one owner module. Import from the owner's public surface and never re-declare owned contracts.
- To use another package's type: import and use it directly, or re-export it (`export type { X } from`). Do not create a wrapper alias.
- A new type that structurally overlaps with an existing type is allowed only when the package cannot expose the original (e.g., exposing only a subset of fields, decoupling from an internal dependency). The new type must have a distinct name that reflects its narrowed purpose.
- Trivial 1:1 type aliases (`type X = Y`) are prohibited. Union, intersection, mapped, and conditional types are valid uses of type aliases.
- Object shapes must use `interface`. Type aliases are for unions, intersections, tuples, mapped types, and primitives.
- Prefer `undefined` over `null` for absence of value. `null` is allowed only at API boundaries (JSON serialization).

### No Fallback Policy

- Fallback logic is prohibited. There must be a single, correct, verifiable path.
- No `try/catch` that silently switches to alternative implementations.
- No logical OR fallbacks for core behavior (`primary() || fallback()`).
- Terminal failure states must remain terminal by default.
- Retry or requeue is allowed only through an explicit policy gate, never as an implicit fallback.
- Public domain functions that can fail MUST return `Result<T, E>`. Throwing is reserved for truly unexpected programmer errors.

### Test-Driven Development

- Follow Kent Beck's Red-Green-Refactor cycle.
- Never write production code without a failing test that demands it.
- Never refactor while tests are failing.
- Bug fixes start with a test that reproduces the bug.

### Build Requirements

- ANY modification to `packages/*/src/` REQUIRES immediate build of the affected scope.
- Never commit code that does not build successfully.
- Mandatory loop: change -> build -> test -> fix -> re-verify.

### Import Standards

- Static ES module imports at the top of files are the default.
- Dynamic import is allowed only for optional modules with explicit ownership and error handling.

### Development Patterns

- NEVER use `console.*` directly in production code.
- ALWAYS use dependency injection for logging and side concerns.
- No blind type assertions without proper validation.
- Separate core behavior from side concerns.
- Prefer `readonly` properties and parameters. Mutation should be explicit and localized.
- Never mutate function parameters directly. Clone or create new objects instead.
- No magic numbers or strings. Use named constants with descriptive names. Exceptions: `0`, `1`, `-1` as array/math primitives.
- Production files should not exceed 300 lines. Functions should not exceed 50 lines. Exceptions require justification in code review.

### API Specification

- Applications with external API endpoints must maintain standardized API specifications (e.g., OpenAPI for HTTP). See `api-spec-management` skill for workflow details.

### Process Lifecycle

- Applications in `apps/` must handle SIGTERM and SIGINT for graceful shutdown.
- In-progress work must complete or be safely cancelled within a configurable timeout.
- All acquired resources (connections, file handles) must be released on shutdown.

### Agent Identity

- Prohibited: `main agent`, `sub-agent`, `parent-agent`, `child-agent`, and any hierarchy-implying naming.
- Approved: `agent`, `agent instance`, `agent replica`, with flat identifiers.

### Styling

- Tailwind CSS utility classes only.
- No inline `style` attributes, custom CSS, or CSS-in-JS.

### Git Operations

- No `git commit` or `git push` without explicit user approval.
- Conventional commit format: `<type>(<scope>): <message>` (max 72 chars).
- Valid types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`.

### Branch Policy

- `main` is the production branch. Direct commits and pushes to `main` are prohibited.
- `develop` is the integration branch. All feature work branches from `develop`.
- Feature branches must be created from `develop` and merged back into `develop`.
- Merging `develop` into `main` requires explicit user approval and is a release-level action.
- When merging a branch, always merge back to the branch it was forked from. Verify the fork point before proposing a merge target.
- If the agent wants to suggest a different merge target than the fork origin, it must explicitly recommend and receive user approval before proceeding.
- Never assume `main` as the default merge target. Always check the actual fork point.
- See [`branch-guard`](.agents/skills/branch-guard/SKILL.md) skill for detailed procedures including worktree isolation and deployment.

### Worktree Isolation

- When performing a large, independent task that requires a different branch context, commit and push current work first, then switch branches. Return to the original branch when done.
- For tasks that must not affect the current working tree, use `git worktree` or a separate clone in a temporary location.
- Always clean up worktrees and temporary clones after the task is complete.

## Skills Reference

Procedural workflows and domain-specific rules live under `.agents/skills/`. Each skill owns its domain details and should be consulted when working in that domain.

| Skill | Purpose |
|-------|---------|
| [`repo-change-loop`](.agents/skills/repo-change-loop/SKILL.md) | Change -> build -> test -> verify workflow |
| [`scenario-verification-harness`](.agents/skills/scenario-verification-harness/SKILL.md) | Scenario pre-check, record, verify |
| [`harness-governance`](.agents/skills/harness-governance/SKILL.md) | Rule/skill/owner drift checks |
| [`type-boundary-and-ssot`](.agents/skills/type-boundary-and-ssot/SKILL.md) | Boundary validation, SSOT ownership |
| [`repo-writing`](.agents/skills/repo-writing/SKILL.md) | Writing rules for docs, `.design/`, commits |
| [`spec-writing-standard`](.agents/skills/spec-writing-standard/SKILL.md) | SPEC.md required sections and quality gates |
| [`dag-node-standard`](.agents/skills/dag-node-standard/SKILL.md) | Node implementation, execution safety |
| [`execution-caching`](.agents/skills/execution-caching/SKILL.md) | Cache-first execution workflows |
| [`package-code-review`](.agents/skills/package-code-review/SKILL.md) | 6-perspective code review with severity labels |
| [`branch-guard`](.agents/skills/branch-guard/SKILL.md) | Branch protection, merge direction, worktree, deploy |
| [`task-tracking`](.agents/skills/task-tracking/SKILL.md) | Task files in `.agents/tasks/` |
| [`contract-audit`](.agents/skills/contract-audit/SKILL.md) | Class contract review and SPEC.md registry |
| [`pnpm-monorepo-build`](.agents/skills/pnpm-monorepo-build/SKILL.md) | Build commands and workflow |
| [`tdd-red-green-refactor`](.agents/skills/tdd-red-green-refactor/SKILL.md) | TDD cycle |
| [`vitest-testing-strategy`](.agents/skills/vitest-testing-strategy/SKILL.md) | Testing strategy |
| [`architecture-patterns`](.agents/skills/architecture-patterns/SKILL.md) | DI, ports-and-adapters |
| [`contract-testing`](.agents/skills/contract-testing/SKILL.md) | Consumer-driven contract testing |
| [`state-machine-design`](.agents/skills/state-machine-design/SKILL.md) | FSM design patterns |
| [`ddd-tactical-patterns`](.agents/skills/ddd-tactical-patterns/SKILL.md) | DDD patterns |
| [`cqrs-event-projection-basics`](.agents/skills/cqrs-event-projection-basics/SKILL.md) | CQRS and event projection |
| [`async-concurrency-patterns`](.agents/skills/async-concurrency-patterns/SKILL.md) | Concurrent async |
| [`effect-style-error-modeling`](.agents/skills/effect-style-error-modeling/SKILL.md) | Result/Either error modeling |
| [`architecture-decision-records`](.agents/skills/architecture-decision-records/SKILL.md) | ADR format |
| [`semver-api-surface`](.agents/skills/semver-api-surface/SKILL.md) | Semantic versioning |
| [`plugin-development`](.agents/skills/plugin-development/SKILL.md) | Plugin development |
| [`robota-sdk-usage`](.agents/skills/robota-sdk-usage/SKILL.md) | SDK usage patterns |
| [`tailwind-truncation`](.agents/skills/tailwind-truncation/SKILL.md) | Tailwind truncation |
| [`logging-level-guide`](.agents/skills/logging-level-guide/SKILL.md) | Log level usage guide |
| [`api-error-standard`](.agents/skills/api-error-standard/SKILL.md) | RFC 7807 API error responses |
| [`api-spec-management`](.agents/skills/api-spec-management/SKILL.md) | API specification management |

## Rules and Skills Boundary

- **Rules** (this file): mandatory constraints. Rules always win on conflict.
- **Skills** (`.agents/skills/`): procedural workflows and domain-specific rules. Skills must not redefine rules in this file.
- **Specs** (`packages/*/docs/SPEC.md`): package-level contracts and domain truth.
- If skill text conflicts with a rule, the rule wins.

## Owner Knowledge Policy

- Each workspace package owns its specification in `docs/SPEC.md`.
- Detailed domain truth lives in specs, ADRs, or contract definitions — not in this file.
- The `spec-writing-standard` skill defines SPEC.md required sections and quality gates.
- When modifying a package, check if `docs/SPEC.md` reflects the current architecture and update if needed.

## Conflict Scan Commands

```bash
rg -n "any/unknown may|fallback to|temporary workaround" .agents/skills AGENTS.md
rg -n "main agent|sub-agent|parent-agent|child-agent" .agents/skills AGENTS.md
rg -n '^## ' AGENTS.md
```
