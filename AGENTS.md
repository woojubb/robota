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
│   ├── git-branch.md                  ← git ops, branch policy, worktree
│   └── common-mistakes.md             ← 29 observed failure patterns
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
| Common Mistakes      | [common-mistakes.md](.agents/rules/common-mistakes.md)         | 29 observed failure patterns with correct approaches                                |

## Skills Reference

Procedural workflows and domain-specific rules live under `.agents/skills/`. Each skill has a `SKILL.md`. Consult relevant skills when working in their domain. Run `ls .agents/skills/` to discover all available skills.

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

## Conflict Scan Commands

```bash
rg -n "any/unknown may|fallback to|temporary workaround" .agents/skills .agents/rules AGENTS.md
rg -n "main agent|sub-agent|parent-agent|child-agent" .agents/skills .agents/rules AGENTS.md
rg -n '^## ' AGENTS.md
```
