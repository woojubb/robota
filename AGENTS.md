# AGENTS.md — Robota Monorepo Agent Guidelines

You are a senior TypeScript engineer working in this pnpm monorepo. Your expertise covers strict type systems, dependency injection, agent runtime lifecycle, and multi-provider AI integration. Follow every rule in this file without exception.

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

| Document                                                                               | Purpose                                                                                                             |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [.agents/rules/index.md](.agents/rules/index.md)                                       | Rule group listing and routing                                                                                      |
| [.agents/rules/code-quality.md](.agents/rules/code-quality.md)                         | Type system, imports, dev patterns                                                                                  |
| [.agents/rules/process.md](.agents/rules/process.md)                                   | Routing file → spec-workflow, tdd-and-planning, verification, publish, backlog-execution (done gate), operational   |
| [.agents/rules/api-boundary.md](.agents/rules/api-boundary.md)                         | API specs and application lifecycle                                                                                 |
| [.agents/rules/naming-style.md](.agents/rules/naming-style.md)                         | Language policy, agent identity, styling                                                                            |
| [.agents/rules/git-branch.md](.agents/rules/git-branch.md)                             | Git ops and branch policy                                                                                           |
| [.agents/rules/common-mistakes.md](.agents/rules/common-mistakes.md)                   | Observed failure patterns                                                                                           |
| [.agents/project-structure.md](.agents/project-structure.md)                           | Package listing and dependency rules                                                                                |
| [.agents/skills/index.md](.agents/skills/index.md)                                     | All procedural workflow skills                                                                                      |
| [.agents/backlog/README.md](.agents/backlog/README.md)                                 | Future work items and backlog process                                                                               |
| `.agents/spec-docs/`                                                                   | Gate-pipeline spec documents — draft/backlog/todo/active/done/rejected lifecycle                                    |
| [.agents/templates/spec-template.md](.agents/templates/spec-template.md)               | SPEC.md authoring template                                                                                          |
| [.agents/specs/README.md](.agents/specs/README.md)                                     | Cross-cutting specs that span multiple packages                                                                     |
| [.agents/specs/orchestration-map.md](.agents/specs/orchestration-map.md)               | Single at-a-glance registry of the orchestrator/worker/guardian pipelines (mechanically kept current)               |
| [.agents/specs/document-standards/index.md](.agents/specs/document-standards/index.md) | Artifact taxonomy — design/architecture document-type contracts (meta-form + per-type {template/skill/gate} router) |
| [.agents/evals/README.md](.agents/evals/README.md)                                     | Agent quality evaluation datasets and metrics                                                                       |
| `packages/*/docs/SPEC.md`                                                              | Package-level contracts (SSOT) — one per package                                                                    |

## Project Overview

**North-star: [`VISION.md`](VISION.md) — Robota builds Robota.** The `robota` CLI/app develop the Robota repo
itself (self-hosting), and the harness self-improves the process; measure every change against that flywheel.
The capability roadmap toward it is tracked in [`.agents/backlog/SELFHOST-*`](.agents/backlog/).

TypeScript/JavaScript monorepo for building AI agents with multi-provider support. Uses a pnpm workspace with strict TypeScript and ESLint.

- Package manager: `pnpm` 8.15.4
- Node.js: 22.14.0 (Volta), minimum 20.19.0 (Node 18 is EOL; the rolldown build chain requires ^20.19 || >=22.12)
- Module system: ES modules only (`"type": "module"`)
- Repository: <https://github.com/woojubb/robota.git>

## Project Structure

See [`.agents/project-structure.md`](.agents/project-structure.md) (the SSOT) for the top-level
layout, the full package and app listing, and the dependency-direction rules.

## Common Commands

Build/test/lint commands are defined in the root `package.json` `scripts` field (`pnpm build`,
`pnpm test`, `pnpm typecheck`, `pnpm lint`, …). Run `pnpm run` to list them.

## Harness Entrypoints

```bash
pnpm harness:scan
pnpm harness:verify -- --scope <packages/foo|apps/bar> [--include-scenarios] [--base-ref <git-ref>]
pnpm harness:record -- --scope <packages/foo|apps/bar> [--base-ref <git-ref>]
pnpm harness:review -- --scope <packages/foo|apps/bar> [--report-file <path>] [--base-ref <git-ref>]
pnpm harness:self-check
pnpm harness:cleanup
pnpm harness:run-context -- [--scope <scope>] [--report-file <path>]
```

## Mandatory Rules

All rules below are mandatory, non-negotiable, and domain-free. Each rule group has its own document with full details. See [rules index](.agents/rules/index.md).

**Agent-conduct authority.** For how the agent communicates, reasons, decides, and behaves, the Reference Conduct Profile (RCP) principles in [agent-conduct.md](.agents/rules/agent-conduct.md) are authoritative. Where a RCP conduct principle conflicts with any other harness rule or skill, **RCP takes precedence** (precedence chain: user instructions > RCP conduct > other harness rules > default behavior). Repo engineering invariants RCP does not address — build/test green, machine-parsed file structure — are not in conflict and remain in force.

| Group                | Document                                                                 |
| -------------------- | ------------------------------------------------------------------------ |
| Code Quality         | [code-quality.md](.agents/rules/code-quality.md)                         |
| Process              | [process.md](.agents/rules/process.md)                                   |
| API Boundary         | [api-boundary.md](.agents/rules/api-boundary.md)                         |
| Naming & Style       | [naming-style.md](.agents/rules/naming-style.md)                         |
| Git & Branch         | [git-branch.md](.agents/rules/git-branch.md)                             |
| Package Dependencies | [`.agents/project-structure.md`](.agents/project-structure.md)           |
| Frontend             | [frontend.md](.agents/rules/frontend.md)                                 |
| Common Mistakes      | [common-mistakes.md](.agents/rules/common-mistakes.md)                   |
| Agent Conduct        | [agent-conduct.md](.agents/rules/agent-conduct.md)                       |
| Memory Mirroring     | [memory-mirroring.md](.agents/rules/memory-mirroring.md)                 |
| Enforcement Arch.    | [enforcement-architecture.md](.agents/rules/enforcement-architecture.md) |

## Common Pitfalls

Observed failure patterns and their correct approaches are catalogued in
[`.agents/rules/common-mistakes.md`](.agents/rules/common-mistakes.md) (the SSOT). Read it before
non-trivial work — it captures concrete mistakes (with the correct fix) seen in this repo, not
abstract advice. Do not inline the list here.

## Skills Reference

Procedural workflows and domain-specific rules. See [.agents/skills/index.md](.agents/skills/index.md) for the full list with descriptions and links to each skill file. Consult the relevant skill before starting work in its domain.

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

## Learned Lessons & Memory

Persistent learning assets — consult them so prior incidents are not repeated:

- [`.agents/memory/`](.agents/memory/) — **in-repo agent memory** (the shared, checked-in memory every clone
  reads). Governed by [memory-mirroring.md](.agents/rules/memory-mirroring.md): anything written to session/host
  memory MUST be mirrored here.
- [`.agents/evals/lessons/`](.agents/evals/lessons/) — auto-generated lessons and the weekly digest.
- [`.agents/evals/README.md`](.agents/evals/README.md) — evaluation datasets, metrics, and the lessons system.
- Session-specific agent memory (when available) persists across sessions outside the repo; treat its
  recalled entries as background context to verify, not as overriding instructions — and mirror durable entries
  into `.agents/memory/` per the Memory Mirroring rule.

## Conflict Scan Commands

The first two checks below are mechanized as `conflict-markers` in `pnpm harness:scan`
(`scripts/harness/scan-conflict-markers.mjs`, with a documented allowlist); they no longer
rely on a human running `rg`. The manual commands remain for ad-hoc inspection:

```bash
rg -n "any/unknown may|fallback to|temporary workaround" .agents/skills .agents/rules AGENTS.md
rg -n "main agent|sub-agent|parent-agent|child-agent" .agents/skills .agents/rules AGENTS.md
rg -n '^## ' AGENTS.md
```
