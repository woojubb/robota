# AGENTS.md — Robota Monorepo Agent Guidelines

You are a senior TypeScript engineer working in this pnpm monorepo. Your expertise covers strict type systems, dependency injection, DAG-based workflow orchestration, and multi-provider AI integration. Follow every rule in this file without exception.

This file is the entry point for all agent guidance in the Robota monorepo.

## Document Discovery Policy

This file contains only domain-free rules and routing. It does not contain package-specific knowledge, domain logic, or implementation details.

**Progressive discovery model:**

1. **Start here.** Read this file for non-negotiable rules and document routing.
2. **Follow links.** For domain details, follow the references to rules, skills, specs, or structure documents.
3. **Dig into packages.** For package-specific contracts, read `packages/<name>/docs/SPEC.md`.

**Principles:**

- This file must remain domain-free. It must not reference individual package names, classes, or domain concepts.
- Domain-specific rules belong in skills (`.agents/skills/`) or package specs (`docs/SPEC.md`).
- Never duplicate content across levels. Each fact has exactly one owner document.
- Intermediate index files (e.g., `.agents/rules/index.md`, `.agents/project-structure.md`) group and route to related documents.
- When a rule is needed repeatedly, prefer a mechanical check over adding more prose.

**Document tree:**

```
AGENTS.md                              ← routing + overview (this file)
├── .agents/rules/                     ← mandatory rule details
│   ├── index.md                       ← rule group listing
│   ├── code-quality.md                ← type system, imports, dev patterns
│   ├── process.md                     ← spec-first, TDD, no fallback, planning, build
│   ├── api-boundary.md                ← API spec, runtime/orchestrator boundary
│   ├── naming-style.md                ← language, identity, styling
│   └── git-branch.md                  ← git ops, branch policy, worktree
├── .agents/project-structure.md       ← package listing and dependency rules
├── .agents/skills/*/SKILL.md          ← procedural workflows and domain rules
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

All rules below are mandatory, non-negotiable, and domain-free. Each rule group has its own document with full details. See [rules index](.agents/rules/index.md).

| Group                | Document                                                       | Key rules                                                                           |
| -------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Code Quality         | [code-quality.md](.agents/rules/code-quality.md)               | Strict TS, no `any`, SSOT types, `interface` for shapes                             |
| Process              | [process.md](.agents/rules/process.md)                         | Spec-first, TDD, no fallback, build verification, publish safety gate, feature docs |
| API Boundary         | [api-boundary.md](.agents/rules/api-boundary.md)               | Runtime=ComfyUI immutable, orchestrator=Robota own                                  |
| Naming & Style       | [naming-style.md](.agents/rules/naming-style.md)               | Language policy, agent identity, Tailwind only                                      |
| Git & Branch         | [git-branch.md](.agents/rules/git-branch.md)                   | Branch policy, conventional commits, worktree                                       |
| Package Dependencies | [`.agents/project-structure.md`](.agents/project-structure.md) | One-way deps, no cycles, no pass-through re-exports                                 |

### Type System (Strict)

See [code-quality.md](.agents/rules/code-quality.md).

### Development Patterns

See [code-quality.md](.agents/rules/code-quality.md).

### Build Requirements

See [process.md](.agents/rules/process.md).

### No Fallback Policy

See [process.md](.agents/rules/process.md).

### Test-Driven Development

See [process.md](.agents/rules/process.md).

### Execution Safety

See [process.md](.agents/rules/process.md) and the [`dag-node-standard`](.agents/skills/dag-node-standard/SKILL.md) skill.

### Execution Caching

See the [`execution-caching`](.agents/skills/execution-caching/SKILL.md) skill.

### Harness Direction

See [process.md](.agents/rules/process.md) and [Harness Entrypoints](#harness-entrypoints).

### Harness Operating Model

See [process.md](.agents/rules/process.md) and [Harness Entrypoints](#harness-entrypoints).

### Git Operations

See [git-branch.md](.agents/rules/git-branch.md).

### Language Policy

See [naming-style.md](.agents/rules/naming-style.md).

### Styling

See [naming-style.md](.agents/rules/naming-style.md).

### Package Dependency Direction (Non-negotiable)

- Bidirectional production dependencies between packages are **prohibited**. If A depends on B, B must NOT depend on A.
- Pass-through re-exports (`export * from '@robota-sdk/other-package'`) are **prohibited**. Consumers must import from the owning package.
- devDependencies for test fixtures do not constitute a production dependency cycle.
- See [`.agents/project-structure.md`](.agents/project-structure.md) for the full dependency graph and per-package rules.

## Skills Reference

Procedural workflows and domain-specific rules live under `.agents/skills/`. Each skill owns its domain details and should be consulted when working in that domain.

| Skill                                                                                    | Purpose                                                                        |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`repo-change-loop`](.agents/skills/repo-change-loop/SKILL.md)                           | Change -> build -> test -> verify workflow                                     |
| [`scenario-verification-harness`](.agents/skills/scenario-verification-harness/SKILL.md) | Scenario pre-check, record, verify                                             |
| [`harness-governance`](.agents/skills/harness-governance/SKILL.md)                       | Rule/skill/owner drift checks                                                  |
| [`type-boundary-and-ssot`](.agents/skills/type-boundary-and-ssot/SKILL.md)               | Boundary validation, SSOT ownership                                            |
| [`repo-writing`](.agents/skills/repo-writing/SKILL.md)                                   | Writing rules for docs, `.design/`, commits                                    |
| [`spec-writing-standard`](.agents/skills/spec-writing-standard/SKILL.md)                 | SPEC.md required sections and quality gates                                    |
| [`spec-first-development`](.agents/skills/spec-first-development/SKILL.md)               | Spec-first workflow for contract boundary changes                              |
| [`spec-code-conformance`](.agents/skills/spec-code-conformance/SKILL.md)                 | Spec-code conformance verification loop after spec changes                     |
| [`dag-node-standard`](.agents/skills/dag-node-standard/SKILL.md)                         | Node implementation, execution safety                                          |
| [`execution-caching`](.agents/skills/execution-caching/SKILL.md)                         | Cache-first execution workflows                                                |
| [`package-code-review`](.agents/skills/package-code-review/SKILL.md)                     | 6-perspective code review with severity labels                                 |
| [`branch-guard`](.agents/skills/branch-guard/SKILL.md)                                   | Branch protection, merge direction, worktree, deploy                           |
| [`task-tracking`](.agents/skills/task-tracking/SKILL.md)                                 | Task files in `.agents/tasks/`                                                 |
| [`contract-audit`](.agents/skills/contract-audit/SKILL.md)                               | Class contract review and SPEC.md registry                                     |
| [`pnpm-monorepo-build`](.agents/skills/pnpm-monorepo-build/SKILL.md)                     | Build commands and workflow                                                    |
| [`tdd-red-green-refactor`](.agents/skills/tdd-red-green-refactor/SKILL.md)               | TDD cycle                                                                      |
| [`pre-refactor-test-harness`](.agents/skills/pre-refactor-test-harness/SKILL.md)         | Analyze → test → extract → verify before modularization                        |
| [`vitest-testing-strategy`](.agents/skills/vitest-testing-strategy/SKILL.md)             | Testing strategy                                                               |
| [`architecture-patterns`](.agents/skills/architecture-patterns/SKILL.md)                 | DI, ports-and-adapters                                                         |
| [`contract-testing`](.agents/skills/contract-testing/SKILL.md)                           | Consumer-driven contract testing                                               |
| [`state-machine-design`](.agents/skills/state-machine-design/SKILL.md)                   | FSM design patterns                                                            |
| [`ddd-tactical-patterns`](.agents/skills/ddd-tactical-patterns/SKILL.md)                 | DDD patterns                                                                   |
| [`cqrs-event-projection-basics`](.agents/skills/cqrs-event-projection-basics/SKILL.md)   | CQRS and event projection                                                      |
| [`async-concurrency-patterns`](.agents/skills/async-concurrency-patterns/SKILL.md)       | Concurrent async                                                               |
| [`effect-style-error-modeling`](.agents/skills/effect-style-error-modeling/SKILL.md)     | Result/Either error modeling                                                   |
| [`architecture-decision-records`](.agents/skills/architecture-decision-records/SKILL.md) | ADR format                                                                     |
| [`semver-api-surface`](.agents/skills/semver-api-surface/SKILL.md)                       | Semantic versioning                                                            |
| [`plugin-development`](.agents/skills/plugin-development/SKILL.md)                       | Plugin development                                                             |
| [`robota-sdk-usage`](.agents/skills/robota-sdk-usage/SKILL.md)                           | SDK usage patterns                                                             |
| [`tailwind-truncation`](.agents/skills/tailwind-truncation/SKILL.md)                     | Tailwind truncation                                                            |
| [`logging-level-guide`](.agents/skills/logging-level-guide/SKILL.md)                     | Log level usage guide                                                          |
| [`api-error-standard`](.agents/skills/api-error-standard/SKILL.md)                       | RFC 7807 API error responses                                                   |
| [`api-spec-management`](.agents/skills/api-spec-management/SKILL.md)                     | API specification management                                                   |
| [`post-implementation-checklist`](.agents/skills/post-implementation-checklist/SKILL.md) | Mandatory post-implementation: SPEC → README → publish → content → docs deploy |
| [`version-management`](.agents/skills/version-management/SKILL.md)                       | Changesets, fixed versioning, all packages same version                        |
| [`deploy-to-vercel`](.agents/skills/deploy-to-vercel/SKILL.md)                           | Deploy applications and websites to Vercel                                     |
| [`vercel-composition-patterns`](.agents/skills/vercel-composition-patterns/SKILL.md)     | React composition patterns and component architecture                          |
| [`vercel-react-best-practices`](.agents/skills/vercel-react-best-practices/SKILL.md)     | React and Next.js performance optimization                                     |
| [`vercel-react-native-skills`](.agents/skills/vercel-react-native-skills/SKILL.md)       | React Native and Expo best practices for mobile apps                           |
| [`web-design-guidelines`](.agents/skills/web-design-guidelines/SKILL.md)                 | UI code review for Web Interface Guidelines compliance                         |

## Rules and Skills Boundary

- **Rules** (`.agents/rules/`): mandatory constraints. Rules always win on conflict.
- **Skills** (`.agents/skills/`): procedural workflows and domain-specific rules. Skills must not redefine rules.
- **Specs** (`packages/*/docs/SPEC.md`): package-level contracts and domain truth.
- If skill text conflicts with a rule, the rule wins.

## Owner Knowledge Policy

- Each workspace package owns its specification in `docs/SPEC.md`.
- Detailed domain truth lives in specs, ADRs, or contract definitions — not in this file.
- The `spec-writing-standard` skill defines SPEC.md required sections and quality gates.
- When modifying a package, check if `docs/SPEC.md` reflects the current architecture and update if needed.

## Common Mistakes

Mistakes observed repeatedly in this codebase. Every item below has caused a real failure.

| #   | Mistake                                                          | Correct approach                                                                |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | Using `any` or `{}` in production code                           | Use `unknown` + narrowing, or define a proper interface                         |
| 2   | Forgetting `pnpm build` before `pnpm test` in a dependency chain | Always run `pnpm build:deps` first, or use `harness:verify`                     |
| 3   | Creating bidirectional package dependencies                      | Dependency direction is one-way; see `.agents/project-structure.md`             |
| 4   | Pass-through re-exports (`export * from '@robota-sdk/other'`)    | Import from the owning package directly                                         |
| 5   | Committing without running `pnpm typecheck`                      | Pre-commit hook runs lint-staged; always verify locally                         |
| 6   | Adding a new package without `docs/SPEC.md`                      | Every workspace package requires a SPEC.md; see `spec-writing-standard` skill   |
| 7   | Using `console.*` in production code                             | Use dependency-injected logger                                                  |
| 8   | Modifying a spec without running the conformance loop            | Every spec change requires `spec-code-conformance` verification                 |
| 9   | Using `try/catch` as a fallback mechanism                        | No fallback policy; terminal failures stay terminal                             |
| 10  | Writing implementation before a failing test                     | TDD: red-green-refactor; write the test first                                   |
| 11  | Publishing without dry-run                                       | Always run `publish --dry-run` first; see `process.md` Publish Safety Gate      |
| 12  | Publishing packages without user approval on scope               | Confirm publish manifest with user; see `process.md` Publish Scope Approval     |
| 13  | agent-core depending on agent-\* packages                        | agent-core MUST NOT depend on any @robota-sdk/agent-\* package                  |
| 14  | Using `npm publish` instead of `pnpm publish`                    | pnpm resolves workspace:\* deps; npm publishes them literally, breaking install |
| 15  | Adding a feature without updating SPEC.md/README.md              | Every new feature requires documentation updates in the same commit/PR          |
| 16  | Hardcoding cross-cutting concerns (fs.appendFile, console.log)   | Use plugin/event architecture; see `code-quality.md` Layered Assembly           |
| 17  | Bypassing layer boundaries (CLI using core internals directly)   | Each layer consumes only its direct dependency's public API                     |
| 18  | Maintaining separate parallel arrays that must stay in sync      | Use a single data structure (array of objects, Map); see `code-quality.md`      |
| 19  | Firing post-event hooks before state mutation is complete        | Post hooks/callbacks fire only after all side effects are done                  |
| 20  | Factory ignoring values available in its config/context object   | Use `options.x ?? context.x`; see `code-quality.md` Layered Assembly            |
| 21  | Refactoring code without updating SPEC.md                        | Reverse verify SPEC after boundary-affecting refactors; see `process.md`        |
| 22  | SPEC hardcoding another package's counts or details              | Reference owning SPEC or describe only observable facts; see `process.md`       |
| 23  | Defining identical interface/type independently in two packages  | One SSOT owner, others import; see `code-quality.md` Type System                |
| 24  | Modifying code without updating SPEC first                       | Update SPEC to describe intended state, then fix code to match                  |
| 25  | Publishing a package without removing "not yet published" labels | Search content/ and docs/ for stale labels when first publishing a package      |
| 26  | Refactoring/modularizing code without test coverage first        | Write characterization tests before extraction; see `pre-refactor-test-harness` |
| 27  | Using `pnpm publish` or `npm publish` directly                   | Always use `pnpm publish:beta`; see `publish.md` Publish Command                |
| 28  | Publishing only some packages (cherry-picking)                   | ALL non-private packages must be published together; see `publish.md`           |

## Conflict Scan Commands

```bash
rg -n "any/unknown may|fallback to|temporary workaround" .agents/skills .agents/rules AGENTS.md
rg -n "main agent|sub-agent|parent-agent|child-agent" .agents/skills .agents/rules AGENTS.md
rg -n '^## ' AGENTS.md
```
