---
title: 'NEUT-004: make .agents/tasks context injection opt-in/configurable + reconcile read-only claim'
status: todo
created: 2026-07-25
priority: medium
urgency: soon
area: packages/agent-framework
depends_on: []
---

# NEUT-004: task-context injection discipline

## Problem (audit .design/audits/2026-07-24-neutrality-prompt-audit.md, surface-tier F2)

Every session on ANY repo unconditionally scans `.agents/tasks/*.md`, parses the Robota harness task
schema (`task-context.ts:60-151`), injects it into the system prompt (priority 27) — no settings/CLI
toggle exists. `updateTaskFileStatus` also WRITES into `.agents/`, contradicting `paths.ts:5`
(".agents/ is read-only from CLI's perspective").

## What

Gate behind settings (`taskContext: { enabled, dir }` — default preserving today's behavior but documented
and off-switchable), or demote to a composition-root opt-in. Reconcile or delete the write API vs the
read-only claim. Low fold-ins: reword "Robota repository convention" comments to "supported convention";
fix the `.robota/skills` project-level discovery asymmetry.

## Test Plan

Red-first: disabled ⇒ no section injected + no scan performed; default unchanged; write-path decision tested.
