---
name: user-request-gate
description: Use immediately when the user requests any implementation, code change, feature addition, fix, or modification. Gates code writing behind a backlog draft document. Read-only exploration is always permitted.
---

## Rule Anchor

- "User Request Implementation Gate" in `.agents/rules/spec-workflow.md`
- "HARD GATE: No Immediate Implementation" in `.agents/rules/spec-workflow.md`

## When to Use

Invoke this skill for **every** user message that requests:

- Implementing a new feature or behavior
- Fixing a bug or error
- Modifying existing code
- Adding or removing functionality
- Refactoring code structure
- Creating a new file (source code)

Do NOT invoke for: read-only explorations, spec/doc writing requests, settings changes, git operations alone.

## Phase 1: Read-Only Exploration (always allowed immediately)

Before any code writing, explore freely:

- Read source files (`Read`, `grep`, `rg`, `find`)
- Run read-only Bash commands (`git log`, `git diff`, `cat`, `ls`)
- Ask clarifying questions

**Hard stop**: Do not call `Write` or `Edit` on `.ts`/`.tsx`/`.js`/`.mjs` files until Phase 3.

## Phase 2: Create Backlog Draft (mandatory before any code change)

1. Choose the spec-doc type from the prefix taxonomy:
   - `BEHAVIOR` — system-internal logic, state transitions
   - `API` — HTTP/WebSocket/MCP interface changes
   - `DATA` — schema, type contract, data model
   - `RULE` — business logic, validation, constraints
   - `SCREEN` — UI/visual output changes
   - `FLOW` — multi-step interaction sequences
   - `INFRA` — build, deploy, CI/CD
   - Others: `PERF`, `SECURITY`, `OBSERVABILITY`, `AGREEMENT`

2. Find the next number for the chosen prefix:

   ```bash
   ls .agents/spec-docs/draft/ .agents/spec-docs/backlog/ .agents/spec-docs/todo/ \
      .agents/spec-docs/active/ .agents/spec-docs/done/ 2>/dev/null \
   | grep "^<TYPE>-" | sort | tail -1
   ```

3. Create `.agents/spec-docs/draft/<TYPE>-NNN-<kebab-slug>.md` using [`backlog-writer`](../backlog-writer/SKILL.md).
   Required frontmatter:

   ```yaml
   ---
   status: draft
   type: <TYPE>
   tags: [<env>, <protocol>]
   ---
   ```

4. **Prior-art research (default-on, [research.md](../../rules/research.md)).** Dispatch the
   `prior-art-researcher` agent (the research WORKER) on the request; paste its returned `## Prior Art Research`
   block into the draft and let its recommendation feed `Alternatives Considered` / `Decision`. Skip ONLY by
   writing an explicit `Waived: <reason>` line under the section — a waiver you propose (research genuinely
   unnecessary) or the user requests. A missing/unsubstantiated section with no waiver FAILS GATE-WRITE
   (`backlog-gate-guard`) and `scan-spec-research.mjs`; on that FAIL, re-drive the researcher (bounded) — do not
   hand-wave past it.

## Phase 3: Gate Pipeline (run before implementing)

After the draft is written:

1. Run `backlog-pipeline` skill to advance through gates:
   - GATE-WRITE: validates spec document completeness
   - GATE-APPROVAL: requires explicit user sign-off
2. Only after GATE-APPROVAL passes, proceed to implementation.

## Phase 4: Implement

After GATE-APPROVAL:

1. Follow [`spec-first-development`](../spec-first-development/SKILL.md)
2. Update the governing `packages/<name>/docs/SPEC.md` (if package behavior changes)
3. Follow [`tdd-red-green-refactor`](../tdd-red-green-refactor/SKILL.md)
4. Follow [`repo-change-loop`](../repo-change-loop/SKILL.md)

## Waiver Protocol

If the user explicitly says "skip spec", "just fix it", "no spec needed", or similar:

1. Acknowledge the waiver in your response:
   > "Proceeding without spec gate per user waiver."
2. Still update the governing `packages/<name>/docs/SPEC.md` if behavior changes.
3. Note the waiver in the PR description.

## Automated Enforcement

`.claude/hooks/spec-first-gate.sh` (UserPromptSubmit hook) automatically injects this reminder
when implementation-intent keywords are detected. The hook does not block — it injects context.
This skill is the procedural companion to that reminder.

## Orchestrated Skills

| Skill                    | Role                                         |
| ------------------------ | -------------------------------------------- |
| `backlog-writer`         | Author the spec draft document               |
| `backlog-pipeline`       | Gate pipeline orchestrator                   |
| `backlog-gate-guard`     | Validate individual gates                    |
| `spec-first-development` | Update package SPEC.md before implementation |
| `tdd-red-green-refactor` | Implementation cycle                         |
| `repo-change-loop`       | Build and verify after implementation        |
