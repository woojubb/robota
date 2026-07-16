---
title: 'SELFHOST-007: branching time-travel checkpoints (rewind to any step, fork alternate branch)'
status: todo
created: 2026-07-16
priority: medium
urgency: later
area: packages/agent-session, packages/agent-core
depends_on: []
---

# Branching time-travel checkpoints

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
