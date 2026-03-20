# AGENTS.md Restructure + Spec-First Rule Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Slim AGENTS.md to a routing hub, extract rules into `.agents/rules/`, add spec-first development rule and skill.

**Architecture:** AGENTS.md keeps overview + routing table. Five rule files under `.agents/rules/` hold details. New `spec-first-development` skill orchestrates existing spec/contract skills.

**Tech Stack:** Markdown files only, no code changes.

---

### Task 1: Create `.agents/rules/` directory and `index.md`

**Files:**
- Create: `.agents/rules/index.md`

**Step 1: Create index file**

```markdown
# Mandatory Rules Index

All rules are mandatory and non-negotiable. Domain-specific rules live in
[skills](../skills/) and [package specs](../../packages/*/docs/SPEC.md).

| Group | Document | Scope |
|-------|----------|-------|
| Code Quality | [code-quality.md](code-quality.md) | Type system, imports, development patterns |
| Process | [process.md](process.md) | Spec-first, TDD, no fallback, planning, build |
| API Boundary | [api-boundary.md](api-boundary.md) | Runtime/Orchestrator API rules, process lifecycle |
| Naming & Style | [naming-style.md](naming-style.md) | Language policy, agent identity, styling |
| Git & Branch | [git-branch.md](git-branch.md) | Git operations, branch policy, worktree isolation |
```

**Step 2: Verify file exists**

Run: `cat .agents/rules/index.md`

---

### Task 2: Create `.agents/rules/code-quality.md`

**Files:**
- Create: `.agents/rules/code-quality.md`

**Step 1: Extract from AGENTS.md**

Copy the following sections verbatim from AGENTS.md into the new file, under a top-level heading:
- `### Type System (Strict)` (lines 91–104)
- `### Import Standards` (lines 136–139)
- `### Development Patterns` (lines 141–150)

Add a file header:

```markdown
# Code Quality Rules

Mandatory rules for type safety, imports, and development patterns.
Parent: [AGENTS.md](../../AGENTS.md) | Index: [rules/index.md](index.md)
```

**Step 2: Verify content matches original**

Run: `diff <(sed -n '91,104p' AGENTS.md) <(sed -n '7,20p' .agents/rules/code-quality.md)` — should show only heading-level differences.

---

### Task 3: Create `.agents/rules/process.md`

**Files:**
- Create: `.agents/rules/process.md`

**Step 1: Extract from AGENTS.md + add new rule**

Copy these sections verbatim:
- `### No Fallback Policy` (lines 106–113)
- `### Test-Driven Development` (lines 115–120)
- `### Planning Requirements` (lines 122–128)
- `### Build Requirements` (lines 130–134)

Add the new Spec-First Development rule:

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
- See [`spec-first-development`](../skills/spec-first-development/SKILL.md) skill for the procedural workflow.
```

Add file header:

```markdown
# Process Rules

Mandatory rules for development process, testing, and build verification.
Parent: [AGENTS.md](../../AGENTS.md) | Index: [rules/index.md](index.md)
```

**Step 2: Verify**

Run: `grep -c '###' .agents/rules/process.md` — expected: 5 (No Fallback, TDD, Planning, Build, Spec-First)

---

### Task 4: Create `.agents/rules/api-boundary.md`

**Files:**
- Create: `.agents/rules/api-boundary.md`

**Step 1: Extract from AGENTS.md**

Copy these sections verbatim:
- `### API Specification` (line 152–154)
- `### Runtime and Orchestrator API Boundary` (lines 156–177)
- `### Process Lifecycle` (lines 179–183)

Add file header:

```markdown
# API Boundary Rules

Mandatory rules for API specifications, runtime/orchestrator boundary, and process lifecycle.
Parent: [AGENTS.md](../../AGENTS.md) | Index: [rules/index.md](index.md)
```

**Step 2: Verify SSOT marker preserved**

Run: `grep "single source of truth" .agents/rules/api-boundary.md` — should match.

---

### Task 5: Create `.agents/rules/naming-style.md`

**Files:**
- Create: `.agents/rules/naming-style.md`

**Step 1: Extract from AGENTS.md**

Copy these sections verbatim:
- `### Language Policy` (lines 83–89)
- `### Agent Identity` (lines 185–188)
- `### Styling` (lines 190–193)

Add file header:

```markdown
# Naming & Style Rules

Mandatory rules for language policy, agent identity naming, and UI styling.
Parent: [AGENTS.md](../../AGENTS.md) | Index: [rules/index.md](index.md)
```

---

### Task 6: Create `.agents/rules/git-branch.md`

**Files:**
- Create: `.agents/rules/git-branch.md`

**Step 1: Extract from AGENTS.md**

Copy these sections verbatim:
- `### Git Operations` (lines 195–199)
- `### Branch Policy` (lines 201–210)
- `### Worktree Isolation` (lines 212–216)

Add file header:

```markdown
# Git & Branch Rules

Mandatory rules for git operations, branch policy, and worktree isolation.
Parent: [AGENTS.md](../../AGENTS.md) | Index: [rules/index.md](index.md)
```

---

### Task 7: Rewrite AGENTS.md Mandatory Rules section

**Files:**
- Modify: `AGENTS.md` (lines 79–216)

**Step 1: Replace the entire Mandatory Rules section (lines 79–216) with routing table**

```markdown
## Mandatory Rules

All rules below are mandatory, non-negotiable, and domain-free. Each rule
group has its own document with full details.
See [rules index](.agents/rules/index.md).

| Group | Document | Key rules |
|-------|----------|-----------|
| Code Quality | [code-quality.md](.agents/rules/code-quality.md) | Strict TS, no `any`, SSOT types, `interface` for shapes |
| Process | [process.md](.agents/rules/process.md) | Spec-first, TDD, no fallback, build verification |
| API Boundary | [api-boundary.md](.agents/rules/api-boundary.md) | Runtime=ComfyUI immutable, orchestrator=Robota own |
| Naming & Style | [naming-style.md](.agents/rules/naming-style.md) | Language policy, agent identity, Tailwind only |
| Git & Branch | [git-branch.md](.agents/rules/git-branch.md) | Branch policy, conventional commits, worktree |
```

**Step 2: Update Document Discovery Policy tree**

Replace the document tree in AGENTS.md to include `.agents/rules/`:

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

**Step 3: Update Conflict Scan Commands**

Update rg paths to include `.agents/rules`:

```bash
rg -n "any/unknown may|fallback to|temporary workaround" .agents/skills .agents/rules AGENTS.md
rg -n "main agent|sub-agent|parent-agent|child-agent" .agents/skills .agents/rules AGENTS.md
rg -n '^## ' AGENTS.md
```

**Step 4: Verify line count reduction**

Run: `wc -l AGENTS.md` — expected: ~120 lines (down from 275).

---

### Task 8: Create `spec-first-development` skill

**Files:**
- Create: `.agents/skills/spec-first-development/SKILL.md`

**Step 1: Write skill file**

```markdown
---
name: spec-first-development
description: Use before implementing any change that touches a contract boundary (package imports, class dependencies, service connections, cross-package types). Ensures the governing spec is updated before code is written and a verification test plan exists.
---

## Rule Anchor

- "Spec-First Development" in `.agents/rules/process.md`

## When to Use

Trigger this skill when a change affects any of these:
- Package public API surface (exports, types, interfaces)
- HTTP/WebSocket API endpoints (request/response shapes)
- Class-to-class dependencies across module boundaries
- Cross-package type definitions or contracts

## Workflow

### Step 1: Identify contract boundaries

List all package/service/class connections affected by the change.
For each boundary, answer:
- What is the current spec? (SPEC.md, OpenAPI, contract definition, or none)
- What part of the spec changes?

### Step 2: Check existing specs

For each identified boundary:
- Package surface → check `packages/<name>/docs/SPEC.md`
- HTTP API → check OpenAPI or API spec document
- Class contract → check contract definition in owning package

If no spec exists, one must be created before proceeding.

### Step 3: Update or create spec

- **Package SPEC.md** → use [`spec-writing-standard`](../spec-writing-standard/SKILL.md)
- **API specification** → use [`api-spec-management`](../api-spec-management/SKILL.md)
- **Class contract** → document in the owning package's `docs/SPEC.md` or dedicated contract file

The spec change must be reviewed and approved before implementation begins.

### Step 4: Define verification test plan

For each spec change, define:
- **What to test:** which contract assertions validate the change
- **How to test:** unit / integration / contract test
- **Commands to run:** exact verification commands

Use [`contract-audit`](../contract-audit/SKILL.md) for contract consistency checks.

### Step 5: Implement to spec

- Write code that conforms to the updated spec
- Follow TDD cycle (see [`tdd-red-green-refactor`](../tdd-red-green-refactor/SKILL.md))
- Build and verify (see [`repo-change-loop`](../repo-change-loop/SKILL.md))

## Orchestrated Skills

| Skill | Role in this workflow |
|-------|----------------------|
| `spec-writing-standard` | SPEC.md structure and quality gates |
| `api-spec-management` | API spec format and update workflow |
| `contract-audit` | Contract consistency verification |
| `tdd-red-green-refactor` | Implementation cycle |
| `repo-change-loop` | Build and verify loop |
```

**Step 2: Add to Skills Reference in AGENTS.md**

Add row to the skills table:

```markdown
| [`spec-first-development`](.agents/skills/spec-first-development/SKILL.md) | Spec-first workflow for contract boundary changes |
```

---

### Task 9: Verify integrity

**Step 1: Check all rule content preserved**

Run: `cat .agents/rules/code-quality.md .agents/rules/process.md .agents/rules/api-boundary.md .agents/rules/naming-style.md .agents/rules/git-branch.md | grep -c '###'`
Expected: 14 (original 13 sections + 1 new Spec-First)

**Step 2: Check no broken links**

Run: `rg -n '\[.*\]\(.*\.md\)' AGENTS.md .agents/rules/ | grep -v node_modules`
Verify all linked files exist.

**Step 3: Check conflict scan still works**

Run: `rg -n "any/unknown may|fallback to|temporary workaround" .agents/skills .agents/rules AGENTS.md`

**Step 4: Verify AGENTS.md line count**

Run: `wc -l AGENTS.md` — expected: ~120 lines

---

## Test Strategy

- **Content preservation:** diff each extracted section against original AGENTS.md to verify no text lost or altered.
- **Link integrity:** grep all markdown links, verify targets exist.
- **Conflict scan:** existing rg commands still produce valid results with updated paths.
- **Skill discovery:** new skill appears in AGENTS.md skills table.
- **No code changes:** this plan is documentation-only, no build/test required.
