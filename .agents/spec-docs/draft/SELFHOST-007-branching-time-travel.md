---
status: draft
type: DATA
tags: [checkpoint, time-travel, rewind, agent-session, agent-core, selfhost]
---

# SELFHOST-007: branching time-travel checkpoints (rewind to any step + fork an alternate branch)

## Problem

Promotes backlog [SELFHOST-007](../../backlog/SELFHOST-007-branching-time-travel.md) toward
[VISION.md](../../../VISION.md). Concrete symptom: Robota has `/rewind`, but it is **linear and destructive**.
`restoreToCheckpoint` in `packages/agent-framework/src/checkpoints/edit-checkpoint-store.ts` restores the code to
an earlier checkpoint by **deleting every later checkpoint** (`later.map(... fsAsync.rm)`,
`removedCheckpointCount: later.length`); `rollbackThroughCheckpoint` does the same for the range. So when Robota
develops Robota and the agent wants to try an alternate approach from step N, it must **throw the current future
away** to go back — there is no way to keep the current line and explore a what-if in parallel. The advertised
frontier for coding agents is **branching**: rewind to any step AND fork an alternate branch, like git for a
session. Robota's rewind is a straight line with an eraser; every competitive agent offers a branchable
checkpoint history.

## Prior Art Research

From product documentation (docs / manuals / design docs — not third-party source):

- **LangGraph time-travel** (<https://docs.langchain.com/oss/python/langgraph/persistence>): each superstep writes a
  checkpoint keyed by a `thread_id` + `checkpoint_id`; you can resume from **any** checkpoint, and resuming from a
  past checkpoint with new input **forks a new line** rather than overwriting — the parent checkpoint and its
  descendants are preserved, so the history is a **tree**, not a stack. Persistence is via a pluggable
  `checkpointer` (neutral saver interface), not a fixed store.
- **aider** (<https://aider.chat/docs/>): `/undo` reverts the last change; a session's edits are tracked as
  discrete, reversible steps. Reversal is step-scoped, but aider's model is still a **single line** — its own docs
  frame branching as a git-branch operation on the repo, not an in-session tree.
- **Claude Code checkpoints** (<https://code.claude.com/docs/>): checkpoints are maintained **separately from git**
  so a rewind restores conversation + file state without touching the user's git history; rewind targets any prior
  point in the session.

**Observed common shape:** (1) checkpoints are content snapshots keyed by a session/thread id and an ordinal;
(2) the persistence mechanism is a **neutral, swappable saver** with no product policy baked in; (3) the frontier
capability is **non-destructive fork** — rewinding to a past point keeps the abandoned future as a sibling branch,
making the history a tree.

**The Robota constraint — what already exists to reuse, and the genuine delta.** Robota **already has (1) and (2)**:
`EditCheckpointStore` (agent-framework) snapshots edited files per turn into a versioned file manifest
(`IEditCheckpointManifest`, `version: 1`, keyed by `sessionId` + a linear `sequence`) under
`projectPaths(cwd).checkpoints`, driven by the interactive session's `SessionHistoryTracker`
(`beginEditCheckpointTurn` at prompt start in `interactive-session-prompt.ts`, `finalizeEditCheckpointTurn` after
the turn in `interactive-session-execution-controller.ts`), and surfaced by the `/rewind` command
(`packages/agent-command/src/rewind/rewind-command.ts`) which routes through
`ICommandHostContext.{list,inspect,restore,rollback}EditCheckpoint`. The **genuine delta is (3) alone**: the store
models history as a **linear `sequence` with destructive restore** (rewinding `rm`'s the later checkpoints). SELFHOST-007
turns that single `sequence` chain into a **parent-linked tree** and makes restore **non-destructive (fork/switch)** —
**reusing the existing store, command seam, and turn hooks**, not inventing a parallel checkpoint system.

## Architecture Review

### Affected Scope

- **`agent-session`** (neutral tree structure): the **checkpoint-tree data structure** — a pure, I/O-free module over
  opaque checkpoint-node ids (`{ id, parentId }` edges + operations `fork`, `switch`, `listBranches`,
  `ancestors`, `activeLeaf`) — lives HERE. `agent-session`'s SPEC already declares it "**owns the storage-neutral
  persistence primitive**" (`SessionStore`/`ISessionRecord` — opaque payloads, no product policy). A pure branch-tree
  over checkpoint ids is the same **neutral mechanism** class (it is git-for-a-session with no file I/O and no
  retention policy), so it belongs alongside that primitive. **Reachability without a cycle:** `agent-framework`
  already declares a production dependency on `agent-session` (`package.json`), and `agent-session` depends only on
  `{agent-core, agent-interface-transport}` — so the agent-framework store can consume the agent-session tree over
  the **existing one-way edge**; the reverse edge (agent-session → agent-framework) would be a cycle and is
  forbidden.
- **`agent-framework`** (existing store, extended — reuse, not parallel): `EditCheckpointStore` and its manifest
  (`IEditCheckpointManifest`) are extended from a linear `sequence` to a tree — each manifest gains `parentId`
  and `branchId`, and `restoreToCheckpoint`/`rollbackThroughCheckpoint` **switch the active-branch pointer** (moving
  the abandoned future onto a sibling branch) **instead of `rm`-ing later checkpoints**. Navigation
  (fork/switch/list-branches) delegates to the neutral `agent-session` tree. This reuses the existing file-manifest
  persistence, the `SessionHistoryTracker` turn hooks, and the `ICommandHostContext` command surface — the whole
  point is to grow the existing seam, not add a second store.
- **`agent-interface-transport`** (session-facing contracts — where rendered session events + the resumable record
  live): the **branch/checkpoint EVENTS a surface renders** (`checkpoint_created`, `branch_forked`,
  `branch_switched`) are added to `IInteractiveSessionEvents` in `session-contracts.ts`, **mirroring `goal_event`
  and `memory_event`**; the **persisted active-branch pointer** is added to `IInteractiveSessionRecord` (so a
  branch survives `--resume`), **mirroring `goal?: IGoalState`** (GOAL-001) — the persisted resumable record is
  owned here per DATA-001. New `/rewind` subcommands (`fork`, `switch`, `branches`) are added to
  `agent-command`'s rewind module + the framework's `rewind-command-api`.
- **NOT `agent-core`** for the session-facing event/record contracts: `agent-core` is the **zero-`@robota`-dependency
  foundation** (`check-dependency-direction.mjs` rule 3) and **cannot reference transport types**. It keeps owning
  the primitives the tree is built over (`IHistoryEntry`, `IEventService`); a purely-internal observability emit may
  still fire through `IEventService`, but the **session-facing** branch event and persisted record are transport
  contracts (see Alternative 3).

### Alternatives Considered

1. **Extend the existing rewind machinery into a tree: neutral checkpoint-tree structure in `agent-session`; the
   `agent-framework` `EditCheckpointStore`/manifest gains `parentId`/`branchId` and becomes non-destructive
   (fork/switch); rendered branch events + the persisted branch pointer in `agent-interface-transport` (mirror
   `goal_event`/`goal?: IGoalState`) (CHOSEN).**
   - ✅ Mirrors the real analog exactly (the checkpoint store that already exists), reuses the file-manifest
     persistence + the `SessionHistoryTracker` turn hooks + the `/rewind` `ICommandHostContext` seam, so there is
     **one** checkpoint SSOT; the neutral tree is pure and consumed over the **existing** agent-framework →
     agent-session edge (no cycle); events land where rendered session events already live; linear rewind is
     preserved as the single-branch degenerate case (capability-preserving).
   - ❌ Making `restore` non-destructive changes existing semantics (today it deletes later checkpoints), and the
     manifest must migrate `version: 1` → `2`; unbounded fork growth needs a prune/GC **policy** (kept out of the
     neutral mechanism — filed as a follow-up). Stated, not hidden.
   - **Why the pure tree lives in `agent-session`, not beside its sole consumer in `agent-framework`:** the tree is a
     neutral, I/O-free navigational primitive of the same class as `SessionStore` (which `agent-session` already owns
     per its SPEC). Placing it in the lower reusable library keeps the pure algorithm out of the heavy assembly layer
     and lets any future consumer depend on it downward, while it stays consumable by `EditCheckpointStore` over the
     existing `agent-framework → agent-session` edge — so the placement is affirmatively correct, not merely "not the
     other options."
2. **Invent a NEW `CheckpointTree` store in `agent-session`, parallel to `EditCheckpointStore`, persisting its own
   branch history.**
   - ✅ Matches the backlog seed's literal "tree in agent-session" wording; clean greenfield with no manifest
     migration.
   - ❌ Creates **two** checkpoint homes (the agent-framework file-manifest store + a new agent-session store) that
     must be kept in sync, duplicates the snapshot/restore machinery, and forks the `/rewind` command path (which
     already routes to agent-framework through `ICommandHostContext`) into two. Violates "reuse the existing
     machinery, do not invent a parallel one" and creates a second SSOT for checkpoints. REJECTED on
     duplication/consistency grounds.
3. **Put the branch EVENT contract + the persisted tree pointer in `agent-core` (the seed's first-listed option).**
   - ✅ `agent-core` is the zero-dep foundation and already owns `IHistoryEntry` + `IEventService`, so it looks like
     the natural home for a "checkpoint event."
   - ❌ The branch events are **rendered by surfaces** (the feature IS showing/switching branches in the UI), so they
     belong in the transport-facing `IInteractiveSessionEvents` map beside `goal_event`/`memory_event`, and the
     persisted branch pointer belongs on `IInteractiveSessionRecord` (DATA-001) — both owned by
     `agent-interface-transport`. `agent-core` **cannot** reference transport types (zero-dep, enforced by
     `check-dependency-direction.mjs` rule 3), and splitting the session event map across two packages fragments the
     SSOT. REJECTED: misplaces a boundary-crossing contract in the zero-dep core (a purely-internal `IEventService`
     emit is fine and is retained, but it is not the session-facing contract).

### Decision

Adopt (1). The **neutral checkpoint-tree structure** (pure, I/O-free, over opaque node ids) lives in `agent-session`
alongside its storage-neutral persistence primitive; the **existing** `agent-framework` `EditCheckpointStore` and its
manifest are extended with `parentId`/`branchId` and made **non-destructive** (rewind = fork/switch, not delete),
delegating navigation to the agent-session tree over the existing one-way dependency edge; the **rendered
branch/checkpoint events** go into `IInteractiveSessionEvents` and the **persisted active-branch pointer** into
`IInteractiveSessionRecord`, both in `agent-interface-transport` (mirroring `goal_event` / `goal?: IGoalState`); the
`/rewind` command gains `fork` / `switch` / `branches` subcommands on the existing seam. `agent-core` keeps owning the
primitives (`IHistoryEntry`, `IEventService`) but does not gain the session-facing contracts. A branch-retention /
prune (GC) policy is a **consciously deferred follow-up** (product policy stays out of the neutral mechanism).

### Validated Recommendation

- **Reachability (the rewind seam is actually reachable + extensible — verified against the code):** the `/rewind`
  command (`agent-command`) delegates through `ICommandHostContext.{list,inspect,restore,rollback}EditCheckpoint`
  (`host-context.ts` lines 171–174) to `EditCheckpointStore` in `agent-framework`, which is created + wired via
  `setEditCheckpointStore` (`interactive-session-init.ts`, `interactive-session.ts`) and driven per turn by
  `SessionHistoryTracker.beginEditCheckpointTurn` (called from `interactive-session-prompt.ts`) /
  `finalizeEditCheckpointTurn` (from `interactive-session-execution-controller.ts`). Adding `fork`/`switch`/`branches`
  subcommands + `parentId` on the manifest extends **this exact seam** — no new command path, no new store. The
  neutral tree is reachable from the store because `agent-framework` already depends on `agent-session`.
- **Capability preservation:** today's linear + destructive `restoreToCheckpoint` / `rollbackThroughCheckpoint` is
  preserved as the **single-branch degenerate case** — a tree with one branch behaves exactly like the current
  sequence. The destructive `rm`-later-checkpoints behavior is **replaced** by moving the abandoned future onto a
  sibling branch, so no reachable state is lost (undo becomes recoverable, a strict superset). `IEditCheckpointManifest`
  migrates `version: 1` → `version: 2`; a v1 manifest (no `parentId`) loads as a linear chain, preserving existing
  sessions. This is demonstrated by tests (TC-02, TC-05), not asserted by a presence grep.
- **Adversarial pass:** strongest failure mode = a **dependency cycle** if the tree structure forced
  `agent-session` to import `agent-framework`, or if the session events were placed in `agent-core` referencing
  transport types. Prevented structurally: the tree is **pure** and in `agent-session` (consumed over the existing
  `agent-framework → agent-session` edge, never the reverse); the rendered events + persisted record are in
  `agent-interface-transport`, not `agent-core`. This rests on a **standing mechanical floor**, not a one-time
  review: `check-dependency-direction.mjs` (the `deps` scan in `pnpm harness:scan`) FAILS on (a) any `agent-core`
  production dependency on another `@robota` package and (b) any dependency cycle (TC-04). Second failure mode =
  **unbounded snapshot growth** as branches multiply (fork never deletes) → a branch-prune/GC policy is required; it
  is a **product policy** and is deliberately kept out of the neutral mechanism and filed as a follow-up, so
  neutrality is not compromised to add retention.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: agent-session (neutral pure checkpoint-tree structure), agent-framework (existing
      `EditCheckpointStore`/manifest extended to a tree, made non-destructive — reuse not parallel),
      agent-interface-transport (rendered branch events on `IInteractiveSessionEvents` + persisted branch pointer on
      `IInteractiveSessionRecord`, mirror `goal_event`/`goal?`), agent-command (rewind `fork`/`switch`/`branches`
      subcommands). agent-core keeps the primitives (`IHistoryEntry`, `IEventService`) — NOT the session-facing
      contracts.
- [x] Sibling scan 완료 — mirrors the **existing rewind machinery** (`EditCheckpointStore` + `SessionHistoryTracker`
      turn hooks + `/rewind` `ICommandHostContext` seam) rather than inventing a parallel store; the session-facing
      event/record contracts mirror the **`goal_event` / `goal?: IGoalState`** precedent (GOAL-001) in
      `agent-interface-transport`. Independent architecture-placement validation to be recorded in the Evidence Log
      at GATE-APPROVAL.
- [x] 대안 최소 2개 — 3 considered (extend-existing-into-a-tree CHOSEN; parallel-agent-session-store REJECTED on
      duplication/two-SSOT; events-in-agent-core REJECTED on boundary/zero-dep), each Pro+Con with correctness-grounds
      rejections.
- [x] 결정 근거 — mirror-an-analog forces reuse of the one existing checkpoint store; capability-preservation keeps
      linear rewind as the single-branch case + non-destructive-superset restore; boundary rule (agent-core zero-dep)
      forces the session-facing contracts into agent-interface-transport; the no-cycle/neutrality criterion rests on
      the standing `deps` scan. GATE-APPROVAL pending.

## Solution

Turn the existing linear, destructive rewind into a non-destructive **checkpoint tree**, reusing every existing
seam:

1. **Neutral tree structure (`agent-session`).** A pure, I/O-free module over opaque checkpoint-node ids —
   `{ id, parentId }` edges with `fork(fromId)`, `switch(toId)`, `listBranches()`, `ancestors(id)`, `activeLeaf()`.
   No file access, no retention policy — the same neutral-mechanism class as `SessionStore`/`ISessionRecord`.
2. **Extend the existing store (`agent-framework`).** `IEditCheckpointManifest` gains `parentId?: string` +
   `branchId: string` and bumps `version: 1 → 2` (a v1 manifest loads as a linear chain). `beginTurn` records the
   active leaf as the new node's parent; `restoreToCheckpoint`/`rollbackThroughCheckpoint` **switch the active-branch
   pointer** (the abandoned future becomes a sibling branch) instead of `rm`-ing later checkpoints. Navigation
   delegates to the agent-session tree.
3. **Session-facing contracts (`agent-interface-transport`).** Add `checkpoint_created` / `branch_forked` /
   `branch_switched` to `IInteractiveSessionEvents` (mirror `goal_event`/`memory_event`) and an active-branch pointer
   to `IInteractiveSessionRecord` (mirror `goal?: IGoalState`, so a branch survives `--resume`).
4. **Command (`agent-command` + framework `rewind-command-api`).** Add `rewind fork <checkpoint-id>`,
   `rewind switch <branch-id>`, `rewind branches` on the existing `ICommandHostContext` surface; `restore` keeps
   working (now non-destructive).

Deferred follow-up (consciously dropped for v1): a branch-retention / prune (GC) policy — product policy, kept out
of the neutral mechanism.

## Affected Files

| File                                                                        | Change                                                                                                      |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `packages/agent-session/src/` (new checkpoint-tree module)                  | neutral pure checkpoint-tree structure (`{id,parentId}` edges + fork/switch/listBranches/ancestors); no I/O |
| `packages/agent-framework/src/checkpoints/edit-checkpoint-types.ts`         | `IEditCheckpointManifest` gains `parentId?`/`branchId`; `version: 1 → 2`                                    |
| `packages/agent-framework/src/checkpoints/edit-checkpoint-store.ts`         | non-destructive restore (fork/switch active branch) delegating navigation to the agent-session tree         |
| `packages/agent-interface-transport/src/session-contracts.ts`               | branch events on `IInteractiveSessionEvents` + active-branch pointer on `IInteractiveSessionRecord`         |
| `packages/agent-framework/src/command-api/checkpoint/rewind-command-api.ts` | `fork` / `switch` / `branches` subcommands + host-context methods                                           |
| `packages/agent-command/src/rewind/rewind-command.ts`                       | route the new subcommands                                                                                   |

## Completion Criteria

- [ ] TC-01: the neutral checkpoint-tree structure supports `fork`, `switch`, `listBranches`, and `ancestors` over
      `{id,parentId}` nodes, with no file/system I/O in the module (unit test + a no-`node:fs`/`node:path`-import
      assertion on the module).
- [ ] TC-02: forking from a past checkpoint **preserves the parent line and diverges** — the parent branch and its
      descendants remain reachable after a fork, and the two branches share the common ancestor (functional test).
- [ ] TC-03: restore is **non-destructive** — restoring to an earlier checkpoint no longer deletes later checkpoints
      (they are reachable on a sibling branch); a v1 (`parentId`-less) manifest loads as a linear chain
      (back-compat + migration unit test).
- [ ] TC-04 (**standing mechanical guard**): no dependency cycle and no `agent-core` → session-facing-contract
      dependency is introduced — the neutral tree stays in `agent-session` (consumed over the existing
      `agent-framework → agent-session` edge), events/record stay in `agent-interface-transport`, and `agent-core`
      gains no `@robota` production dependency. Enforced mechanically by `check-dependency-direction.mjs` (the `deps`
      scan in `pnpm harness:scan`), which FAILS on any agent-core `@robota` production dep or any cycle — the
      criterion rests on the standing scan, not a one-time review. (Per
      [enforcement-architecture.md](../../rules/enforcement-architecture.md): every guardian needs a mechanical
      floor.) **Neutrality note:** no existing scan mechanically fences "no product/retention policy in `packages/`"
      for checkpoints; like SELFHOST-003's TC-04, a follow-up mechanical neutrality floor (a no-retention-policy /
      dependency-allowlist scan for the checkpoint modules) is filed so branch-prune policy cannot creep into the
      neutral mechanism — neutrality does not rest on manual review alone.
- [ ] TC-05: the `/rewind` command exposes `fork` / `switch` / `branches` through the existing `ICommandHostContext`
      seam and the branch survives `--resume` (persisted-record round-trip) — the linear `restore`/`rollback` path
      still passes unchanged (capability-preservation regression test). Includes the **cross-store referential-integrity
      edge**: the active-branch pointer persists in `IInteractiveSessionRecord` (agent-session `SessionStore`,
      `~/.robota/sessions`) while the branch tree persists in the agent-framework manifest (`projectPaths.checkpoints`);
      a `--resume` whose pointer references a `branchId` **absent from the manifest store** must degrade gracefully
      (fall back to the linear HEAD / report a missing branch), not crash.

## Test Plan

| TC    | Verification                                        | Type/Tool                                      |
| ----- | --------------------------------------------------- | ---------------------------------------------- |
| TC-01 | tree ops fork/switch/listBranches/ancestors; no I/O | vitest unit + import-shape assertion           |
| TC-02 | fork preserves parent + diverges                    | functional test                                |
| TC-03 | non-destructive restore + v1→v2 migration           | vitest unit                                    |
| TC-04 | no cycle / agent-core zero-dep neutrality           | `pnpm harness:scan` (`deps`) + follow-up floor |
| TC-05 | `/rewind` fork/switch/branches + resume round-trip  | vitest unit (command + persistence)            |

## Tasks

`.agents/tasks/SELFHOST-007*.md` — 미생성 (GATE-APPROVAL 통과 후 생성). Slices: P1 = neutral tree structure +
manifest `parentId`/`branchId` migration; P2 = non-destructive restore (fork/switch) in the existing store; P3 =
session-facing branch events + persisted branch pointer + `/rewind` subcommands; P4 (deferred) = branch-retention /
prune (GC) policy.

## Evidence Log

- 2026-07-17 — **Draft authored.** Grounded in the real rewind machinery:
  `packages/agent-framework/src/checkpoints/edit-checkpoint-store.ts` (linear `sequence`, destructive
  `restoreToCheckpoint`/`rollbackThroughCheckpoint`), `edit-checkpoint-types.ts` (`IEditCheckpointManifest`,
  `version: 1`), `interactive-session-history-tracker.ts` + `interactive-session-prompt.ts` +
  `interactive-session-execution-controller.ts` (per-turn `beginEditCheckpointTurn`/`finalizeEditCheckpointTurn`
  hooks), `command-api/checkpoint/rewind-command-api.ts` + `command-api/host-context.ts` (the `ICommandHostContext`
  rewind seam), `packages/agent-command/src/rewind/rewind-command.ts` (the `/rewind` command),
  `packages/agent-interface-transport/src/session-contracts.ts` (`IInteractiveSessionEvents` `goal_event`/`memory_event`
  precedent + `IInteractiveSessionRecord.goal?` / `.history` persisted-record precedent, DATA-001),
  `packages/agent-core/src/interfaces/messages.ts` (`IHistoryEntry`) + `event-service/interfaces.ts` (`IEventService`),
  and the dependency facts (`agent-framework` → `agent-session`; `agent-core` zero `@robota` deps) enforced by
  `scripts/harness/check-dependency-direction.mjs`. Placement reconciles the backlog seed ("tree in agent-session")
  with the real code (the checkpoint store lives in agent-framework): the **neutral pure tree** lives in
  agent-session, the **existing store** in agent-framework is extended (not duplicated) over the existing one-way
  edge, and the **session-facing event/record contracts** go to agent-interface-transport (not agent-core, which is
  zero-dep).
- 2026-07-17 — **GATE-APPROVAL iteration 1: ENDORSE** (independent proposal-reviewer). Every load-bearing premise
  verified against the code (checkpoint machinery in agent-framework, linear/destructive restore; agent-session owns
  the storage-neutral primitive; `goal_event`/`goal?` precedent; agent-core zero-`@robota`-dep enforced by
  `check-dependency-direction.mjs`; the `ICommandHostContext` rewind seam). Placement correct on every boundary; the
  tree is a derived view over the single on-disk manifest SSOT (not a second store); TC-04 rests on the real `deps`
  scan floor. Folded the reviewer's non-blocking refinements: affirmative co-location justification for the pure tree;
  TC-05 now covers the cross-store referential-integrity edge (stale/missing `branchId` on `--resume` degrades
  gracefully); the manifest `version:1→2` bump is a literal-type widening + a loader mapping a `parentId`-less v1
  manifest onto a synthetic linear chain (noted for the P1 task); the `restore` (`sequence>target`) vs `rollback`
  (`sequence>=target`) distinct fork points to be nailed in P2. **GATE-APPROVAL PASSED.**
