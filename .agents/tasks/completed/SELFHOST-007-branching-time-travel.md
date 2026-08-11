---
title: 'SELFHOST-007: branching time-travel checkpoints (rewind to any step, fork alternate branch)'
status: done
completed: 2026-07-18
created: 2026-07-16
priority: medium
urgency: later
area: packages/agent-session, packages/agent-core
depends_on: []
---

# Branching time-travel checkpoints

## Outcome (DONE 2026-07-18)

Shipped: branchable checkpoint tree (rewind to any step + fork/switch alternate branches) in
`packages/agent-session/src/checkpoint-tree.ts`. Spec:
`.agents/spec-docs/done/SELFHOST-007-branching-time-travel.md` (GATE-IMPLEMENT+VERIFY+COMPLETE 2026-07-18,
TC-01..05; landed via PR #1215 per git history). Verified 2026-07-24: `checkpoint-tree.test.ts` green (8 tests).

Part of [SELFHOST-000](SELFHOST-000-self-hosting-capability-roadmap.md) / [VISION.md](../../VISION.md).
Differentiator. Robota has `/rewind`, but the advertised frontier is **branching**: rewind to any step and
**fork** an alternate branch (what-if), like git for a session.

## What

A checkpoint **tree** (not just linear rewind) in `agent-session`: checkpoint events in `agent-core`, persist a
branchable history, `/rewind` extended to fork/switch branches. Neutral persistence mechanism.

## Prior Art

LangGraph time-travel: rewind to any checkpoint, fork alternate branches, fault-tolerant resume
(https://docs.langchain.com/oss/python/langgraph/persistence); aider `/undo` + branch a session
(https://aider.chat/docs/); Claude Code checkpoints separate from git (https://code.claude.com/docs/).

## Test Plan

Unit tests for the checkpoint tree (branch, fork, switch); a functional test that forking preserves the parent
and diverges; persistence round-trip. Architecture Review confirms the tree lives in agent-session with events
in agent-core.
