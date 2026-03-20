# Design: AGENTS.md Restructure + Spec-First Development Rule

**Date:** 2026-03-14
**Status:** Approved

## Problem

1. AGENTS.md is 275 lines and growing. Mixing core principles with detailed rules makes it hard to maintain and slows agent context loading.
2. No mandatory rule enforces spec-first development. Changes to contract boundaries (package imports, class dependencies, service connections) are implemented without updating or creating the governing spec, leading to drift and hard-to-debug mismatches.

## Design

### Part 1: AGENTS.md Restructure

Extract detailed rules into `.agents/rules/` sub-documents. AGENTS.md keeps only:
- Project overview
- Document discovery policy (updated routing tree)
- Mandatory rules as a routing table (1-line summary + link per group)
- Skills reference table
- Rules/skills boundary
- Owner knowledge policy
- Conflict scan commands

#### New directory structure

```
.agents/
├── rules/
│   ├── index.md          ← Rule group listing with links
│   ├── code-quality.md   ← Type System, Import Standards, Development Patterns
│   ├── process.md        ← Spec-First, TDD, No Fallback, Planning, Build
│   ├── api-boundary.md   ← API Spec, Runtime/Orchestrator API Boundary, Process Lifecycle
│   ├── naming-style.md   ← Language Policy, Agent Identity, Styling
│   └── git-branch.md     ← Git Operations, Branch Policy, Worktree Isolation
├── skills/               ← (unchanged)
├── tasks/                ← (unchanged)
└── project-structure.md  ← (unchanged)
```

#### AGENTS.md Mandatory Rules section (after)

```markdown
## Mandatory Rules

All rules below are mandatory and non-negotiable. Each rule group has its
own document with full details. See [rules index](.agents/rules/index.md).

| Group | Document | Key rules |
|-------|----------|-----------|
| Code Quality | [code-quality.md](.agents/rules/code-quality.md) | Strict TS, no `any`, SSOT types, `interface` for shapes |
| Process | [process.md](.agents/rules/process.md) | Spec-first, TDD, no fallback, build verification |
| API Boundary | [api-boundary.md](.agents/rules/api-boundary.md) | Runtime=ComfyUI immutable, orchestrator=Robota own |
| Naming & Style | [naming-style.md](.agents/rules/naming-style.md) | Language policy, agent identity, Tailwind only |
| Git & Branch | [git-branch.md](.agents/rules/git-branch.md) | Branch policy, conventional commits, worktree |
```

### Part 2: Spec-First Development Rule

Added to `.agents/rules/process.md`:

```markdown
### Spec-First Development

- Any change touching a contract boundary (package imports, class
  dependencies, service connections, cross-package types) MUST update
  or create the governing spec BEFORE writing implementation code.
- Spec format follows the boundary type:
  - HTTP API → standardized API specification (e.g., OpenAPI)
  - Package public surface → `docs/SPEC.md`
  - Class/interface dependency → contract definition in the owning package
- Every spec change MUST include a verification test plan.
- Implementation code that does not conform to its governing spec is a bug.
```

### Part 3: `spec-first-development` Skill

New skill at `.agents/skills/spec-first-development/SKILL.md`.

Procedural workflow:

1. **Identify contract boundaries** — Which package/service/class connections are affected?
2. **Check existing specs** — Does a SPEC.md, OpenAPI doc, or contract definition exist?
3. **Update or create spec** — Use `spec-writing-standard` for SPEC.md, `api-spec-management` for API specs.
4. **Define verification test plan** — What contract tests validate the spec? Use `contract-audit` for consistency.
5. **Implement** — Code to spec, TDD cycle, build and verify.

Orchestrates existing skills: `spec-writing-standard`, `api-spec-management`, `contract-audit`.

## Decisions

- **Rule groups are files, not folders.** Each group is a single markdown file. If a group outgrows one file, it can be split into a folder with an index.md later.
- **AGENTS.md stays the entry point.** Agents always start here. The routing table points them to details on demand.
- **No content duplication.** Each rule has exactly one owner document. AGENTS.md has summaries, not copies.
- **Existing skills unchanged.** The new skill orchestrates them; it does not replace them.

## Test Strategy

- After restructure: `rg` commands in AGENTS.md conflict scan still work.
- No rule text lost: diff old AGENTS.md sections against new rule files.
- New skill: manual walkthrough — trigger spec-first workflow on a contract boundary change and verify each step.
- Build/typecheck passes after all changes.
