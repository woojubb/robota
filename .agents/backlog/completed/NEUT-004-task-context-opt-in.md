---
title: 'NEUT-004: make .agents/tasks context injection opt-in/configurable + reconcile read-only claim'
status: done
completed: 2026-07-25
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

## Outcome (2026-07-25)

Shipped (red-first): `loadContext(cwd, memoryStore, { taskContext: { enabled, dir } })` gates the
scan — `enabled: false` performs NO `.agents/tasks` walk; `dir` replaces the scan directory
(`ITaskSelectionOptions.dir` on `loadTaskContext`/`discoverTaskFiles`). Settings-driven:
`taskContext: { enabled, dir }` added to `SettingsSchema`/`IResolvedConfig` and plumbed in
`createInteractiveSession` (config resolves before context). Default unchanged (enabled,
`.agents/tasks`). Write-vs-read-only reconciled by DELETING `updateTaskFileStatus` (zero
consumers; the library never writes into `.agents/`; breaking, beta). Fold-ins: "Robota
repository convention" comment reworded to "supported convention"; project-level
`.robota/skills` added to skill discovery (asymmetry fix). SPEC updated.
