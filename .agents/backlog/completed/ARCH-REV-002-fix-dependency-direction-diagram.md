---
title: 'ARCH-REV-002: Fix dependency-direction.md diagram errors (4 inaccuracies verified against package.json)'
status: todo
created: 2026-05-18
priority: critical
urgency: now
area: .agents/specs/architecture-map/dependency-direction.md, .agents/specs/architecture-map/capability-placement.md
depends_on: []
---

## Problem

Four verified inaccuracies in `dependency-direction.md` will mislead dependency decisions:

1. **D-01 — TypeContracts→Domain edge is wrong**: Both `agent-interface-transport` and `agent-interface-tui` have **zero** runtime dependencies — not even `agent-core`. Verified by both `package.json` files: `"dependencies": {}`. The table description also says "no runtime deps beyond agent-core," implying agent-core is a current dep (it is not). An agent reading this will incorrectly add agent-core as a runtime dep to future interface packages.

2. **D-02 — Assembly→Orchestration edge is wrong**: `agent-framework` does NOT depend on `agent-team`. Verified: `agent-framework/package.json` has no `agent-team` dep. Only consumer of `agent-team` in production is `agent-playground` (`packages/agent-playground/package.json` confirmed). The edge should be `Playground --> Orchestration`.

3. **D-03 — Assembly node label omits agent-command**: `capability-placement.md` explicitly places `agent-command` in the Assembly layer. `dependency-direction.md` Assembly node says `"agent-framework, apps/agent-server"` — `apps/agent-server` is a deployment unit (Firebase Functions), not an SDK assembly package. `apps-and-deployment.md` correctly treats it as a deployment unit.

4. **M-04 — agent-subagent-runner classified inconsistently**: Listed as standalone `OptIn` layer in `dependency-direction.md` but inside `Services` subgraph in `capability-placement.md`. One canonical layer needed.

Source: Senior Design Architect (D-01, D-02, D-03, M-04), verified against actual `package.json` files.

## Recommendation

**Proceed without user approval** — all inaccuracies verified against actual `package.json` files.

1. Remove the `TypeContracts --> Domain` Mermaid edge. Update the "Type contracts" table row to say "Pure TypeScript interfaces, **zero** runtime deps — not even agent-core."
2. Change `Assembly --> Orchestration` to `Playground --> Orchestration`.
3. Update the Assembly Mermaid node label to include `agent-command` and remove `apps/agent-server`.
4. For `agent-subagent-runner`: keep it as `OptIn` node in `dependency-direction.md` (the layer is correctly distinct since it's opt-in deployment). Update `capability-placement.md` to move it out of the `Services` subgraph and into its own `OptIn` subgraph to match `dependency-direction.md`.

## Test Plan

- Verify `packages/agent-interface-transport/package.json` — `"dependencies": {}` before and after
- Verify `packages/agent-interface-tui/package.json` — `"dependencies": {}` before and after
- Verify `packages/agent-framework/package.json` — no `agent-team` dependency
- Verify `packages/agent-playground/package.json` — has `agent-team` dependency
- `pnpm harness:scan` must pass after the change

## User Execution Test Scenarios

Not applicable — documentation-only change with no runnable user-facing behavior.
