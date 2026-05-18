---
title: 'DOCS-001: Sync content/ documentation to current architecture'
status: todo
created: 2026-05-18
priority: high
urgency: soon
area: content/
depends_on: []
---

## Problem

`content/` documentation is out of sync with the current package architecture.
Three categories of drift exist: renamed packages, deleted packages (consolidated into subpaths
or merged), and new packages that have no presence in user-facing docs.

**Scope**: All non-auto-generated, non-v2.0.0 files in `content/`.
Excluded: `content/api-reference/**` (auto-generated), `content/v2.0.0/**` (permanent archive),
`content/guide/release-2026-05-02.md` (historical changelog — keep stale names as-is, they
describe what changed at that point in time).

Source of truth for all changes: `.agents/specs/architecture-map/agent-system.md` +
`packages/*/docs/SPEC.md`.

---

## Category 1 — Renamed packages (stale import-level names)

| Old name (stale)             | Current name                  | What moved there                      |
| ---------------------------- | ----------------------------- | ------------------------------------- |
| `@robota-sdk/agent-sdk`      | `@robota-sdk/agent-framework` | `InteractiveSession`, `createQuery()` |
| `@robota-sdk/agent-sessions` | `@robota-sdk/agent-session`   | `SessionStore`, `ISessionRecord`      |
| `@robota-sdk/agent-runtime`  | `@robota-sdk/agent-executor`  | background task contracts             |

### Files affected (stale `agent-sdk` — 12 occurrences)

- `content/README.md` — install instructions, ASCII diagram, package table, prose
- `content/examples/streaming.md`
- `content/examples/http-transport.md`
- `content/examples/mcp-transport.md`
- `content/examples/ws-transport.md`
- `content/examples/one-shot-query.md`
- `content/examples/session-management.md`

### Files affected (stale `agent-sessions` — 3 occurrences)

- `content/README.md`
- `content/examples/session-management.md`

### Files affected (stale `agent-runtime` — 2 occurrences in non-release files)

- `content/README.md`

---

## Category 2 — Deleted / consolidated packages

These packages no longer exist as standalone `@robota-sdk/*` packages.
All references must be updated to the consolidated form.

### `agent-transport-tui` → `agent-transport/tui` subpath

`agent-transport-tui` was never a separate npm package. The TUI layer lives in
`@robota-sdk/agent-transport` under the `/tui` subpath (i.e., `agent-transport/tui`).

Files that use the old name `agent-transport-tui`:

- `content/guide/architecture.md` — ASCII diagram, package role table, dependency flow table,
  React isolation table, transport adapter table (7 occurrences)
- `content/guide/cli.md` — prose ("TuiStateManager (in `agent-transport-tui`)")

### `agent-provider-anthropic`, `agent-provider-openai`, `agent-provider-gemini`, etc. → `agent-provider/*` subpaths

Individual `@robota-sdk/agent-provider-*` packages no longer exist. All providers are
consolidated into `@robota-sdk/agent-provider` with subpath exports.

Files listing individual provider packages:

- `content/development/README.md` — monorepo structure tree lists `agent-provider-anthropic/`,
  `agent-provider-openai/`, `agent-provider-gemini/`, `agent-provider-google/`,
  `agent-provider-deepseek/`, `agent-provider-gemma/`, `agent-provider-qwen/`

Note: `content/guide/building-agents.md` already uses correct subpath form
(`@robota-sdk/agent-provider/anthropic`) — no change needed there.

### `agent-plugin-*` individual packages → `@robota-sdk/agent-plugin` (consolidated)

`content/development/README.md` still lists `agent-plugin-*/` (wildcard for old individual
packages). The current structure is one consolidated `@robota-sdk/agent-plugin` package.

### `agent-remote/` typo → `agent-remote-client/`

`content/guide/architecture.md` mentions `agent-remote/` (line ~164) — this should be
`agent-remote-client/`.

---

## Category 3 — New packages not mentioned in docs

The following packages exist in `packages/` but have zero presence in `content/`
user-facing documentation (outside of `architecture.md`).

| New package             | Role                                                                               | Where to add                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `agent-subagent-runner` | Opt-in child-process subagent runner; install only when needed                     | `content/README.md` package table + `content/development/README.md` structure tree        |
| `agent-interface-tui`   | TUI interaction type contracts (`ITuiCommandInteraction`, etc.); zero runtime deps | `content/guide/architecture.md` contracts section                                         |
| `agent-team`            | Multi-agent task delegation (playground stack); consumed by `agent-playground`     | `content/README.md` package table (optional / advanced) + `content/development/README.md` |

Note: `agent-interface-transport` is already documented in `content/guide/architecture.md`.
`agent-playground` is mentioned in `content/guide/architecture.md` React isolation table but
not in `content/README.md` — add to table as browser/playground package.

---

## Implementation Plan

Work file-by-file. After each file, run the grep verification for that file before moving on.

1. **`content/README.md`**
   - Rename `agent-sdk` → `agent-framework` in ASCII diagram, package table, install instructions, prose
   - Rename `agent-sessions` → `agent-session`; `agent-runtime` → `agent-executor`
   - Add `agent-subagent-runner` row to package table
   - Add `agent-team` row to package table (mark as advanced / playground stack)

2. **`content/examples/*.md`** (6 files)
   - Replace `from '@robota-sdk/agent-sdk'` → `from '@robota-sdk/agent-framework'`
   - Replace `from '@robota-sdk/agent-sessions'` → `from '@robota-sdk/agent-session'`

3. **`content/guide/architecture.md`**
   - Replace all `agent-transport-tui` → `agent-transport/tui`
   - Add `agent-interface-tui` row to the contracts section of the package role table
   - Fix `agent-remote/` → `agent-remote-client/` if present
   - Remove stale `(was agent-sdk)` annotation (already partially correct — verify consistency)

4. **`content/guide/cli.md`**
   - Replace `agent-transport-tui` in prose → `agent-transport/tui`

5. **`content/development/README.md`**
   - Replace monorepo structure tree with current package listing:
     - Remove: `agent-sessions/`, `agent-sdk/`, `agent-provider-*/` (individual), `agent-plugin-*/`
     - Add: `agent-session/`, `agent-framework/`, `agent-executor/`, `agent-provider/`,
       `agent-plugin/`, `agent-interface-transport/`, `agent-interface-tui/`,
       `agent-subagent-runner/`, `agent-team/`, `agent-transport/`, `agent-command/`,
       `agent-tool-mcp/`, `agent-remote-client/`, `agent-web-ui/`, `agent-playground/`

---

## Verification Steps

```bash
# Category 1 — renamed: must return 0 results (excluding release notes and v2.0.0/api-ref)
grep -rn "@robota-sdk/agent-sdk\|@robota-sdk/agent-sessions\|@robota-sdk/agent-runtime" \
  content/ --include="*.md" \
  | grep -v "v2.0.0" | grep -v "api-reference" | grep -v "release-"

# Category 2 — deleted: must return 0 results
grep -rn "agent-transport-tui\b" content/ --include="*.md" | grep -v "v2.0.0" | grep -v "api-reference"
grep -rn "@robota-sdk/agent-provider-\|agent-provider-anthropic\|agent-provider-openai" \
  content/ --include="*.md" | grep -v "v2.0.0" | grep -v "api-reference" | grep -v "release-"
grep -rn "agent-plugin-\*\|agent-plugin-[a-z]" \
  content/ --include="*.md" | grep -v "v2.0.0" | grep -v "api-reference"

# Category 3 — new packages present in README table
grep -n "agent-subagent-runner\|agent-interface-tui\|agent-team" content/README.md

# Sanity check: current exports still exist
grep -n "InteractiveSession\|createQuery\|SessionStore" packages/agent-framework/src/index.ts
```

## Test Plan

- All grep checks above return the expected results
- `pnpm harness:scan` passes
- `pnpm docs:build` completes without error

## User Execution Test Scenarios

Not applicable — documentation-only update with no interactive user-facing behavior.
