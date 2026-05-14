---
title: 'CTX-001: Hash-based staleness detection for .md files loaded in agent context'
status: done
created: 2026-05-14
priority: medium
urgency: later
area: agent-sessions, agent-core
---

## Problem

When an agent session loads multiple `.md` files into context (SPEC.md, rules, skill files, etc.),
those files can be modified externally — by the user, another process, or a concurrent tool call —
while the session is still live. The agent continues operating from a stale snapshot with no
awareness that the on-disk state has diverged.

The current design has no mechanism to detect this divergence. There is no checksum, mtime record,
or version token associated with loaded context files, so the agent cannot distinguish between:

- a file that is current (hash matches what was loaded), and
- a file that was modified after it was loaded into context (hash mismatch).

This is observable today when a user edits a SPEC.md or rules file mid-session and the agent
proceeds to answer questions based on the pre-edit version.

## Proposed Solution

Maintain a per-file content hash (SHA-256 or equivalent) at the point each `.md` file is read into
context. On each subsequent reference — or on a configurable periodic tick — re-hash the on-disk
file and compare against the stored value.

On mismatch:

1. Mark the context entry as stale.
2. Re-read the file and replace the stale entry in the active context window.
3. Emit a trace event (`context.file.refreshed`) so hooks and observability tooling can act on it.

The hash index should be stored in the session state alongside the file content, not in a separate
process-global cache, to keep session isolation clean.

## Scope Boundaries

- Only applies to explicitly loaded `.md` files (SPEC.md, rules, skills, AGENTS.md, CLAUDE.md).
- Does not apply to code files or binaries — those are read on-demand per tool call and are
  inherently fresh.
- Hash check frequency and invalidation policy (eager vs. lazy vs. tick-based) is a design
  decision to be resolved in the implementation spec.

## Acceptance Criteria

- [ ] `IContextEntry` (or equivalent) stores `contentHash` alongside `content`.
- [ ] A `checkContextStaleness()` call compares on-disk hash against stored hash for each loaded file.
- [ ] Stale files are re-read and their context entry updated before the next agent turn.
- [ ] A `context.file.refreshed` event is emitted on each replacement.
- [ ] No regression in session startup time (hash computation is non-blocking).

## Test Plan

- Unit: `checkContextStaleness()` returns stale for a file written to disk after load, and fresh for
  an unmodified file.
- Unit: stale file is re-read and `contentHash` updated after refresh.
- Integration: session with two SPEC.md files loaded — mutate one mid-session — confirm the agent
  reflects the new content on the next turn.
- Harness: `pnpm harness:verify` passes with no type regressions.

## User Execution Test Scenarios

Not applicable — this is a runtime session internals change with no direct CLI or TUI surface at
this stage. Observable effect (agent sees updated SPEC content mid-session) can be verified via
integration tests and trace events. Add a user execution test scenario when a visible signal (e.g.,
a status-bar indicator for stale context files) is designed.
