---
title: 'ARCH-REV-009: Update cross-cutting-contracts.md — add missing transport and plugin contract rows'
status: todo
created: 2026-05-18
priority: high
urgency: now
area: .agents/specs/architecture-map/cross-cutting-contracts.md
depends_on: []
---

## Problem

`cross-cutting-contracts.md` contract owner index is missing rows for two cross-cutting contract families:

1. **Transport contracts**: `ITransportAdapter` and `IConfigurableTransport` from `agent-interface-transport` are consumed by `agent-cli`, `agent-framework`, all transport shells, and `apps/agent-web`. These are cross-cutting contracts but absent from the index. A developer looking for "who owns the transport contract" will not find it here.

2. **Plugin opt-in contract**: `agent-plugin` is listed in layer diagrams as opt-in but the index has no row pointing to the plugin registration contract, event subscription model, or the "consumer opt-in" composition rule.

The cross-cutting index is the first place a developer looks for contract ownership. Missing rows cause independent rediscovery or boundary violations.

Source: Senior Planner (M-05, m-05).

## Recommendation

**Proceed without user approval** — adding rows to an existing index is purely additive with no design ambiguity.

Add the following rows to the "Contract Owner Index" table:

- Transport protocol contracts → `packages/agent-interface-transport/` (owner: `agent-interface-transport`)
- TUI interface contracts → `packages/agent-interface-tui/` (owner: `agent-interface-tui`)
- Plugin opt-in contract → `packages/agent-plugin/docs/SPEC.md` (owner: `agent-plugin`)

Also update the Mermaid diagram in the file to include the transport and TUI interface contract nodes.

## Test Plan

- Verify `packages/agent-interface-transport/src/` has the contract files (`transport-adapter.ts`, `transport-config.ts`)
- Verify `packages/agent-interface-tui/src/` has interface files
- `pnpm harness:scan` must pass after the change

## User Execution Test Scenarios

Not applicable — documentation-only change with no runnable user-facing behavior.
