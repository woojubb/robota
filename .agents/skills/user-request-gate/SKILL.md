---
name: user-request-gate
description: Use immediately when the user requests any implementation, code change, feature addition, fix, or modification. Gates code writing behind a backlog draft document. Read-only exploration is always permitted.
loop: over=finding-set; escape=no-progress
invocable: true
---

## Rule Anchor

- "User Request Implementation Gate" in `.agents/rules/spec-workflow.md`
- "HARD GATE: No Immediate Implementation" in `.agents/rules/spec-workflow.md`
- "Lanes" in `.agents/rules/spec-workflow.md` — the lane decides whether a draft exists at all

## When to Use

Invoke this skill for **every** user message that requests:

- Implementing a new feature or behavior
- Fixing a bug or error
- Modifying existing code
- Adding or removing functionality
- Refactoring code structure
- Creating a new file (source code)

Do NOT invoke for: read-only explorations, spec/doc writing requests, settings changes, git operations alone.

Before the first recommendation or exploration round on a non-protected topic branch, run
`pnpm harness:work-run -- claim`. Reuse the run opened by post-checkout when present; this explicit
entrypoint is earlier when the request arrives before branch setup. See [track-work-run](../track-work-run/SKILL.md).

## Phase 1: Read-Only Exploration (always allowed immediately)

Before any code writing, explore freely:

- Read source files (`Read`, `grep`, `rg`, `find`)
- Run read-only Bash commands (`git log`, `git diff`, `cat`, `ls`)
- Ask clarifying questions

**Hard stop**: Do not call `Write` or `Edit` on `.ts`/`.tsx`/`.js`/`.mjs` files until Phase 3 — or,
for an L0 change (Phase 2 step 0), until the lane is declared and its ground named.

## Phase 2: Create Backlog Draft (mandatory before any code change)

0. **Decide the lane first.** Read `.agents/rules/spec-workflow.md` > Lanes and derive the floor from the
   paths the change will touch. **L0** needs no draft: declare `Lane: L0` and the ground (the issue, or a
   `Fast-track:` line quoting the user's instruction verbatim) on the branch and the pull request, and
   go to Phase 4 — `scan-lane-declaration` refuses the declaration if the diff's floor is higher.
   **L1** uses `node scripts/harness/new-spec.mjs <ID> --type <T> --issue <N> --lane L1` to scaffold the
   draft — the scaffold writes the `Waived:` line research.md accepts, so step 4's research dispatch is
   not required for L1 (the author may still research) — fills Problem, Decision and the TC-N criteria,
   and goes to Phase 3 where `gate.mjs approve` then `gate.mjs judge --gate PLAN` run. **L2** takes
   steps 1–4 as written. On a branch stacked on another feature branch, set `HARNESS_BASE_REF=<that
branch>` before any base-reading step (`scan-lane-declaration`, `run-all-scans --affected`,
   `gate.mjs approve --route CLASS`), or the measured diff is the parent branch's as well.

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
   (`backlog-gate-guard`) and `scan-spec-research.mjs`; on that FAIL, re-drive the researcher — and stop when the
   same gaps recur unchanged, escalating to the user rather than re-driving into the same answer
   ([no-progress escape](../../rules/enforcement-architecture.md)). "Bounded" with no number was no bound at all; the escape is the bound. Do not
   hand-wave past the FAIL either way.

## Phase 3: Gate Pipeline (run before implementing)

After the draft is written:

1. Run `backlog-pipeline` skill to advance through gates. For each gate it runs
   `node scripts/harness/gate.mjs judge --gate <GATE> --doc <PATH>`; on exit 0 with no semantic
   criteria pending, the gate is passed and the entry is written; `backlog-gate-guard` is dispatched
   only when it exits non-zero or reports semantic criteria (L2).
   - L1: one PLAN gate (`draft → approved` — GATE-WRITE's mechanical criteria plus GATE-APPROVAL)
   - L2: GATE-WRITE (document completeness), then GATE-APPROVAL (explicit user sign-off)
2. Approval is recorded with
   `node scripts/harness/gate.mjs approve --doc <PATH> --route DIRECT|CLASS --instruction "<verbatim>" [--class <ID>]`
   — BEFORE the gate that contains GATE-APPROVAL, which reports those criteria PENDING (exit 2) until
   it has run; status moves are `node scripts/harness/gate.mjs advance --doc <PATH>`.
3. Only after GATE-APPROVAL (or the L1 PLAN gate) passes, proceed to implementation.

**L1, in order:** scaffold (`new-spec.mjs … --lane L1`) → write → `gate.mjs approve --route CLASS
--class LANE-L0-L1` (evidence measured by the script) → `gate.mjs judge --gate PLAN --lane L1` →
`gate.mjs advance` → ONE planning commit (trailer `Lane: L1`) → implement (Phase 4) → tick the TC boxes,
the Task Plan and the Test Plan references → `gate.mjs record`
per TC → `gate.mjs judge --gate DONE --lane L1 --verify-cmd …` → `gate.mjs advance` → Task to
`completed/` → commit.

## Phase 4: Implement

After GATE-APPROVAL:

1. Follow [`spec-first-development`](../spec-first-development/SKILL.md)
2. Update the governing `packages/<name>/docs/SPEC.md` (if package behavior changes)
3. Follow [`tdd-red-green-refactor`](../tdd-red-green-refactor/SKILL.md)
4. Follow [`repo-change-loop`](../repo-change-loop/SKILL.md)
5. Bind and start the work run before the first implementation edit, then bracket implementation and
   verification phases as [track-work-run](../track-work-run/SKILL.md) defines.

## Fast Track (there is no waiver)

If the user explicitly says "skip spec", "just fix it", "no spec needed", or similar, that is not a
process exception to acknowledge — it is the fast track in `.agents/rules/spec-workflow.md` > Lanes:

1. The lane is still the diff's. Declare it as Phase 2 step 0 requires; the instruction does not lower it.
2. Add `Fast-track: <the user's instruction, quoted verbatim>` to the PR body. The PR is the record;
   a chat transcript or a reply is not.
3. Never on a path whose floor is L2 — `scan-lane-declaration` refuses it, and the full lane runs.
4. Still update the governing `packages/<name>/docs/SPEC.md` if behavior changes.

## Automated Enforcement

`.claude/hooks/spec-first-gate.sh` (UserPromptSubmit hook) automatically injects this reminder
when implementation-intent keywords are detected. The hook does not block — it injects context.
This skill is the procedural companion to that reminder.

## Orchestrated Skills

| Skill                      | Role                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `backlog-writer`           | Author the spec draft document                                                                    |
| `backlog-pipeline`         | Gate pipeline orchestrator                                                                        |
| `scripts/harness/gate.mjs` | Judge the mechanical criteria, record approval, move status                                       |
| `backlog-gate-guard` agent | Validate the semantic criteria ([gate catalogue](../../specs/gate-catalogue.md)), or any non-PASS |
| `spec-first-development`   | Update package SPEC.md before implementation                                                      |
| `tdd-red-green-refactor`   | Implementation cycle                                                                              |
| `repo-change-loop`         | Build and verify after implementation                                                             |

## Record the run

Open a ledger entry before the first round, record each round's finding count, and close it with the
terminal reason it actually reached — `converged`, `no-progress`, `bound-reached`, `halted-for-user`, or
`abandoned` if it stopped without reaching any of them. A run that leaves no record cannot be told from a
run that never happened ([a loop run is recorded](../../rules/enforcement-architecture.md), which owns
what each terminal reason means).

```bash
node scripts/harness/loop-run.mjs open  --loop user-request-gate
node scripts/harness/loop-run.mjs round --loop user-request-gate --run <id> --findings <n>
node scripts/harness/loop-run.mjs close --loop user-request-gate --run <id> --terminal <reason>
```

## Combined Issue lifecycle (PROC-017)

For a recommendation-gated, single-cause P0 or P1 enhancement Issue with the exact
`Conversion evidence:` receipt, the conversion commit and approved PLAN may precede implementation on
the same topic branch. The normal L2 approval, checkpoint ancestry, review, CI, merge, and writeback
gates still apply; missing or mismatched conversion evidence fails closed.
