# DQ-AUDIT-004 / 005 — Proper Architecture Redesign — 2026-06-14

Per user direction (2026-06-14): design the architecturally-correct placement regardless of cost/scale
— no cheap half-measures. Now also enforced by `.agents/rules/code-quality.md` > "Proper architecture
over cheap fixes". This document is the design to confirm before implementation (design-confirmation gate).

---

## DQ-AUDIT-004 — Session analysis: proper placement

### Problem (from design-quality audit)

`agent-cli/src/session-analyzer/` holds ~570 lines of real observability logic (timing classification,
aggregation, reporting) plus a **duplicate** `ISessionRecord`/`ISessionHistoryEntry` — violating the
agent-cli thin-shell rule (DQ-06) and Type SSOT (DQ-05). OBS-001 placed it here; its intent ("parser
분리하여 테스트 가능") is preserved by the proper design, only the location changes.

### Proper design — new package `@robota-sdk/agent-session-analytics`

A session-log **analytics/observability** concern is distinct from session lifecycle/persistence and from
the CLI shell. It gets its own package.

```
@robota-sdk/agent-session-analytics   ← NEW: pure analysis over canonical session records
  deps: agent-session (ISessionRecord SSOT), agent-core (IHistoryEntry, token estimator)
  owns:
    - analyzeSession(record: ISessionRecord): ISessionTimingReport
    - aggregateReports(reports: ISessionTimingReport[]): IAggregateReport
    - formatSingleSession(report): string   (pure string formatting)
    - formatAggregateReport(aggregate): string
    - analytics types: ITimingInterval, TIntervalKind, ISessionTimingReport, ITimingStats, IAggregateReport
  NO file I/O, NO process.*, NO CLI concerns. Reuses canonical ISessionRecord — duplicate types deleted (DQ-05).

agent-session (unchanged API)          ← already owns SessionStore.save/load/list/delete + ISessionRecord
                                          The analytics package consumes ISessionRecord[]; records are
                                          loaded via SessionStore (no ad-hoc JSON.parse in the analyzer).

agent-cli/src/session-analyzer/        ← SHRINKS to thin command wiring only (legitimate shell work):
  session-analyze-command.ts:
    - parse --last/--session args
    - resolve user + project session dirs (agent-framework userPaths/projectPaths)
    - load records via SessionStore(baseDir).list()/load()   ← persistence, not re-parsing
    - call agent-session-analytics, write formatted string to stdout, exit codes
```

### Edges & rules

- `agent-session-analytics → agent-session → agent-core` — one-way, no cycle.
- agent-cli depends on the new package + agent-session (already) + agent-framework (paths). Thin shell restored.
- New package: `packages/agent-session-analytics/` with package.json, tsconfig, tsdown build, SPEC.md,
  vitest; registered in `.agents/project-structure.md` + publish-registry + changeset (fixed group).
- parser/reporter tests move into the new package; the command keeps a thin wiring test in agent-cli.

### Why a new package (not folding into agent-session)

agent-session's responsibility is **lifecycle + persistence**. Post-hoc timing analysis + report rendering
is a separate observability responsibility; folding it in would broaden agent-session's scope and mix read-
side analytics with write-side persistence. A dedicated package keeps each responsibility single-owner.

---

## DQ-AUDIT-005 — Transport: proper decomposition

### Problem

`agent-transport` fuses unrelated runtime concerns under one publishable unit, and its root barrel
`export *`s the TUI — so importing the package root drags React 19 + ink + node-pty + hono + ws + mcp-sdk
into any consumer's graph (DQ-08). Consumers actually need disjoint slices:

- agent-cli → headless + tui + TransportRegistry
- agent-web-ui → **ws types only** (but currently pulls the whole graph)
- tests → testing fixtures
- http, mcp → **zero real consumers** (docs/examples only)

### Proper design — split by runtime concern (one publishable unit per concern)

```
@robota-sdk/agent-transport            ← lean CORE: TransportRegistry + headless (pure TS, node stdlib only)
  deps: agent-interface-transport, agent-framework, agent-core   (no react/ink/hono/ws/mcp)

@robota-sdk/agent-transport-tui        ← React 19 + ink + node-pty + marked-terminal + chalk
  deps: agent-transport(core), agent-interface-tui, agent-interface-transport, agent-framework, agent-core

@robota-sdk/agent-transport-ws         ← ws + WS protocol/messages (TServerMessage/TClientMessage)
  deps: agent-transport(core), agent-interface-transport, agent-framework, agent-core

@robota-sdk/agent-transport-http       ← hono HTTP server
  deps: agent-transport(core), agent-interface-transport, agent-framework, agent-core

@robota-sdk/agent-transport-mcp        ← @modelcontextprotocol/sdk server
  deps: agent-transport(core), agent-interface-transport, agent-framework, agent-core
```

Rationale: each concern carries a distinct heavy dependency (react/ink, ws, hono, mcp-sdk). Separate
packages mean a consumer pulls only what it uses — agent-web-ui depends on `agent-transport-ws` types and
never sees React/hono; the CLI pulls `-tui` only for interactive mode. No root barrel re-exports the TUI.

### Consumer migration

- `agent-cli/cli.ts`: `renderApp`/`createDefaultTuiCliAdapter` → `-tui`; `PrintTerminal`/`promptInput`/
  `HeadlessInteractionChannel` → core; `createDefaultTransportRegistry` → core (registry pre-registers
  WsTransport, so core depends on `-ws`? see note).
- `agent-web-ui` (3 files): ws types → `@robota-sdk/agent-transport-ws`.
- tests: `createScriptedProvider` → keep a `testing` entry (in core or a `-testing` package).
- `apps/blog` example doc: `HttpTransport` import path → `-http`.

**Open sub-decision (registry ↔ ws coupling):** `createDefaultTransportRegistry()` currently pre-registers
`WsTransport`. To keep core free of `-ws`, the default-registry factory that wires concrete transports moves
to the **composition root** (agent-cli) or a tiny `-defaults` seam, while core keeps the generic
`TransportRegistry` (no concrete transport import). Recommended: registry stays generic in core; agent-cli
(composition root) wires WsTransport into it — consistent with the existing composition-root exemption.

### Scope

5 packages (1 reshaped + 4 new), consumer rewiring (agent-cli, agent-web-ui, blog example, tests),
per-package SPEC.md, project-structure.md + publish-registry updates, lockfile, changeset (fixed group).
Sequenced as its own multi-step backlog (DQ-AUDIT-005) given the size.

---

## Proposed execution order

1. **DQ-AUDIT-004** first (smaller, self-contained, unblocks Type SSOT) — new analytics package + cli shrink.
2. **DQ-AUDIT-005** next (large transport split) — core + 4 concern packages + consumer migration.
3. Then DQ-AUDIT-006 (error/observability hygiene), DQ-AUDIT-007 (NITs).

Both 004 and 005 keep user-facing behavior identical (`robota session analyze` output unchanged; transport
runtime behavior unchanged) — verified by moving tests + running the CLI command post-migration.
