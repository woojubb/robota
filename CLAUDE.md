# CLAUDE.md — Robota Monorepo

This file provides guidance for Claude Code when working with this repository.

## Project Overview

Robota is a **TypeScript/JavaScript monorepo** for building AI agents with multi-provider support (OpenAI, Anthropic, Google AI). It uses a pnpm workspace with strict TypeScript, ESLint, and a DAG-based orchestration system.

- **Package manager**: pnpm 8.15.4
- **Node.js**: 22.14.0 (Volta), minimum 18.0.0
- **Module system**: ES modules only (`"type": "module"`)
- **Repository**: https://github.com/woojubb/robota.git

## Common Commands

```bash
pnpm install                          # Install all dependencies
pnpm build                            # Build all packages
pnpm build:deps                       # Build dependency packages
pnpm --filter @robota-sdk/<pkg> build # Build specific package
pnpm test                             # Run all tests (Vitest)
pnpm typecheck                        # TypeScript strict check
pnpm lint                             # Lint all packages (ESLint)
pnpm docs:build                       # Generate API documentation (TypeDoc)
```

## Project Structure

```
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
└── dag-nodes/          # DAG node implementations (12 sub-packages)
apps/
├── web/                # Web application
├── docs/               # Documentation site
└── api-server/         # API server
```

### DAG Dependency Direction (Mandatory)

- `dag-core` is the SSOT contract package for all DAG packages.
- All other dag packages (`dag-runtime`, `dag-worker`, `dag-scheduler`, `dag-projection`, `dag-api`, `dag-designer`) depend on `dag-core`.
- `dag-designer` must NOT import runtime/worker/scheduler implementations directly.

## Mandatory Rules

The project maintains detailed rules in `.cursor/rules/`. All rules below are mandatory and non-negotiable.

### Language Policy

- **Code and comments**: English only
- **Conversations with user**: Korean only
- **Documents in `.design/`**: Korean only
- **Documents in all other folders**: English only
- **Commit messages**: English only, conventional commits format

### Type System (Strict)

- TypeScript strict mode is immutable — never disable it.
- `any`, `unknown`, `{}` types are **prohibited** in production code.
- `// @ts-ignore`, `// @ts-nocheck` are **prohibited**.
- `I*` prefix for interfaces only, `T*` prefix for type aliases only.
- In test files (`*.test.ts`, `*.spec.ts`), `any`/`unknown` may be used for mocks only.
- Follow Owner-based SSOT: every concept has exactly one owner module. Import from the owner's public surface, never re-declare.

### No Fallback Policy

- Fallback logic is prohibited. There must be a single, correct, verifiable path.
- No `try/catch` that silently switches to alternative implementations.
- No logical OR fallbacks for core behavior (`primary() || fallback()`).
- Terminal failure states (`failed`, `cancelled`) must remain terminal by default.

### Build Requirements

- ANY modification to `packages/*/src/` REQUIRES immediate build.
- Never skip builds after code changes in packages.
- Never commit code that doesn't build successfully.
- Mandatory loop: change -> build -> smoke test -> fix -> re-verify.

### Import Standards

- NEVER use `await import()` in the middle of functions.
- ALWAYS use standard ES module imports at the top of files.
- Dynamic import allowed only for optional modules with explicit error handling.

### Development Patterns

- NEVER use `console.*` directly in production code.
- ALWAYS use dependency injection for logging: `constructor(private logger: SimpleLogger = SilentLogger)`.
- No temporary workarounds, dummy data, or type assertions to bypass builds.
- No blind type assertions (`as any`, `as unknown`) without proper validation.

### Agent Identity

- Prohibited: "main agent", "sub-agent", "parent-agent", "child-agent" and any hierarchy-implying naming.
- Approved: "agent", "agent instance", "agent replica" with flat identifiers (`agent_0`, `agent_1`).

### Styling

- Tailwind CSS utility classes only. No inline `style` attributes, custom CSS, or CSS-in-JS.

### Git Operations

- No `git commit` or `git push` without explicit user approval.
- Conventional commit format: `<type>(<scope>): <message>` (max 80 chars).
- Valid types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`.

### DAG Node Implementation

- Every node class must extend `AbstractNodeDefinition`.
- Config validation through `configSchemaDefinition` + base-class runtime parse.
- Use `NodeIoAccessor` helpers for input validation (no manual key access).
- Cost computation via `estimateCostWithConfig(...)` override.
- Validation failures: `DAG_VALIDATION_*` codes. Execution failures: `DAG_TASK_EXECUTION_*` codes.

### Execution Safety

- No duplicate prevention anti-patterns. Design systems that don't generate duplicates.
- Failure layers: `[EMITTER-CONTRACT]` (contract violations) and `[APPLY-LAYER]` (workflow apply failures) — both stop immediately.
- Event names must use declarative constants with correct ownership/prefix.
- DAG events: `run.*`, `task.*`, `worker.*`, `scheduler.*` prefixes.

### Execution Caching

- ALWAYS check cache before LLM calls.
- ALWAYS save successful LLM results to cache.
- NEVER run executions repeatedly without cache utilization.

## Skills Reference

Procedural workflows and implementation guides are in `.cursor/skills/`. Key skills for dag-* work:

| Skill | Path | Purpose |
|-------|------|---------|
| dag-node-standard | `.cursor/skills/dag-node-standard/` | Node implementation workflow and templates |
| pnpm-monorepo-build | `.cursor/skills/pnpm-monorepo-build/` | Build commands and workflow guidance |
| quality-standards | `.cursor/skills/quality-standards/` | Type system design and quality gates |
| vitest-testing-strategy | `.cursor/skills/vitest-testing-strategy/` | Testing strategy (unit, integration, type-level) |
| contract-testing | `.cursor/skills/contract-testing/` | Consumer-driven contract testing |
| boundary-validation | `.cursor/skills/boundary-validation/` | External data validation at trust boundaries |
| state-machine-design | `.cursor/skills/state-machine-design/` | Finite state machine design patterns |
| ddd-tactical-patterns | `.cursor/skills/ddd-tactical-patterns/` | DDD patterns (Aggregate, Value Object, Domain Event) |
| cqrs-event-projection-basics | `.cursor/skills/cqrs-event-projection-basics/` | CQRS and event projection fundamentals |
| async-concurrency-patterns | `.cursor/skills/async-concurrency-patterns/` | Concurrent async with limits and cancellation |
| effect-style-error-modeling | `.cursor/skills/effect-style-error-modeling/` | Result/Either-based error modeling |
| functional-core-imperative-shell | `.cursor/skills/functional-core-imperative-shell/` | Pure logic core, side effects at boundaries |
| hexagonal-architecture-ts | `.cursor/skills/hexagonal-architecture-ts/` | Ports-and-adapters architecture |
| ts-oop-di-patterns | `.cursor/skills/ts-oop-di-patterns/` | DI, composition over inheritance |
| development-architecture-guidance | `.cursor/skills/development-architecture-guidance/` | Error handling, DI, interface design |
| import-standards | `.cursor/skills/import-standards/` | ES module import patterns |
| commit-message-guidance | `.cursor/skills/commit-message-guidance/` | Commit message examples |
| writing-language-guide | `.cursor/skills/writing-language-guide/` | Language usage for docs and commits |
| scenario-guard-checklist | `.cursor/skills/scenario-guard-checklist/` | Pre-change checklist for scenario modifications |
| verification-guard | `.cursor/skills/verification-guard/` | Guarded example verification |
| execution-caching | `.cursor/skills/execution-caching/` | Execution caching workflows |
| execution-cache-ops | `.cursor/skills/execution-cache-ops/` | Cache operational commands |
| architecture-decision-records | `.cursor/skills/architecture-decision-records/` | ADR format and workflow |
| semver-api-surface | `.cursor/skills/semver-api-surface/` | Semantic versioning for monorepo |
| plugin-development | `.cursor/skills/plugin-development/` | Plugin development with validation |
| robota-sdk-usage | `.cursor/skills/robota-sdk-usage/` | SDK usage patterns and migration |
| tailwind-truncation | `.cursor/skills/tailwind-truncation/` | Tailwind truncation patterns |

## Rules and Skills Boundary

- **Rules** (`.cursor/rules/`): Mandatory constraints and prohibitions. Always win on conflict.
- **Skills** (`.cursor/skills/`): Procedural playbooks and implementation workflows. Must not relax rule-level constraints.
- If skill text conflicts with a rule, the rule wins.

## Code Review Focus Areas (dag-* packages)

When reviewing dag-* code, check:

1. **Dependency direction**: All imports flow toward `dag-core`. No cross-imports between sibling packages.
2. **Type safety**: No `any`/`unknown` in production code. Strict TypeScript compliance.
3. **SSOT compliance**: Types imported from owner package, no re-declarations.
4. **Node implementation**: Extends `AbstractNodeDefinition`, uses `NodeIoAccessor`, proper error codes.
5. **No fallback patterns**: Single correct path, no silent alternatives.
6. **Event naming**: Correct prefixes (`run.*`, `task.*`, `worker.*`, `scheduler.*`), no hardcoded strings.
7. **State machine integrity**: Terminal states remain terminal without explicit policy gate.
8. **Build verification**: All changes build successfully before completion.
9. **Agent identity**: No hierarchy-implying naming or concepts.
10. **Import standards**: Static ES module imports only, no dynamic imports.
