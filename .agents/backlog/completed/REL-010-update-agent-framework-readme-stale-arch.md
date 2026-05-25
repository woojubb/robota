---
title: 'REL-010: Update agent-framework README stale architecture section'
status: done
done_at: 2026-05-25
created: 2026-05-25
priority: high
urgency: soon
area: packages/agent-framework/README.md
depends_on: []
---

## Background

`packages/agent-framework/README.md` references non-existent package names in its
architecture description:

- Line 5: "composes `agent-core`, `agent-tools`, `agent-sessions`, `agent-provider-anthropic`"
- Lines 69–85: architecture diagram uses `agent-sessions`, `agent-provider-anthropic`

Neither `agent-sessions` nor `agent-provider-anthropic` exist as package names.
Correct names: `agent-session` (no s), `agent-provider` (consolidated, not per-provider).

This was not updated when the architecture consolidated. A developer reading the README
gets a wrong mental model of the dependency graph before even installing anything.

Source: pre-release dev audit §8g (2026-05-25).

## Change Required

Update `packages/agent-framework/README.md`:

- Replace all occurrences of `agent-sessions` → `agent-session`
- Replace all occurrences of `agent-provider-anthropic` → `agent-provider`
- Verify the architecture diagram (if Mermaid) reflects the current package topology:
  `agent-core → agent-session → agent-tools → agent-framework`

## Acceptance Criteria

- No occurrences of `agent-sessions` or `agent-provider-anthropic` in
  `packages/agent-framework/README.md`
- Package dependency description matches `packages/agent-framework/package.json` dependencies
