# Architecture Map Review — Comprehensive Summary

Reviewed: 2026-05-18  
Branch: `develop`  
Reviewers: Senior Design Architect · Senior Developer · Senior Planner  
Individual reports: [design-architect](arch-review-design-architect.md) · [developer](arch-review-developer.md) · [planner](arch-review-planner.md)

---

## Executive Summary

The architecture map is mature and well-structured. The CLI subsystem is exhaustively documented with 23 audit items and a clean composition tree. The dependency-direction rules, capability-placement decision tables, and cross-cutting contracts index are all actionable. **No critical architectural integrity failures were found** — all layer boundaries verified against `package.json` are intact.

The primary problems are: (1) **factual inaccuracies** in 7 files that will actively mislead developers reading the map, and (2) **asymmetric coverage** — the CLI path is deeply documented while multi-agent orchestration, MCP server mode, and transport subpaths receive only label-level mentions. A new senior developer can orient quickly but cannot make confident decisions in the under-documented areas.

**13 backlog items** are derived from this review: 9 are factual fixes, 4 are new content creation.

---

## Findings by Severity

### Critical (misleads developers immediately)

| ID   | Source | File                           | Finding                                                                                                                                                                                                                                                                                                    |
| ---- | ------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-01 | Dev    | `composition-tree.md`          | Entire startup call sequence is stale (pre-`createAgentRuntime` refactor). `startCli()` no longer calls the documented functions directly — they are encapsulated in `createCommandSetup()`, `createProviderSetup()`, `createSessionSetup()`, `createAgentRuntime()`. Also: `cli.ts` is 98 lines, not 196. |
| C-02 | Dev    | `composition-tree.md`          | `TuiTransport` constructor signature is wrong. Documented as `{ cwd, provider, ..., transportRegistry, cliAdapter }`, actual is `options: ITuiRenderOptions` with a `runtime: IAgentRuntime` field.                                                                                                        |
| C-03 | Dev    | `class-interface-inventory.md` | `createProviderFromSettings` owner documented as `agent-cli/src/utils/provider-factory.ts` — that file does not exist. Function is exported from `@robota-sdk/agent-framework`.                                                                                                                            |
| C-04 | Dev    | `execution-modes.md`           | WebSocket Sidecar Mode documents `startWebSidecarServer()`, `--web` flag, `web-sidecar/web-sidecar-server.ts` — none of these exist in the codebase. Feature was planned or removed but not marked.                                                                                                        |
| C-05 | Plan   | `project-structure.md`         | `apps/agent-web-ui/` (line 25) — actual directory is `apps/agent-web/`. Highest-visibility error for new developers.                                                                                                                                                                                       |

### Major (significant gaps or inaccuracies)

| ID   | Source | File                                                   | Finding                                                                                                                                                                                                                                                |
| ---- | ------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-01 | Arch   | `dependency-direction.md`                              | `TypeContracts --> Domain` edge is wrong. Both `agent-interface-transport` and `agent-interface-tui` have **zero** runtime deps — not even `agent-core`. Table also misleadingly says "no runtime deps beyond agent-core."                             |
| D-02 | Arch   | `dependency-direction.md`                              | `Assembly --> Orchestration` edge is unverified. `agent-framework` does NOT depend on `agent-team`. Sole consumer is `agent-playground` (Playground layer). Edge should be `Playground --> Orchestration`.                                             |
| D-03 | Arch   | `dependency-direction.md`                              | Assembly node omits `agent-command`; includes `apps/agent-server` (a deployment unit, not an SDK assembly package).                                                                                                                                    |
| M-04 | Arch   | `dependency-direction.md` vs `capability-placement.md` | `agent-subagent-runner` classified as standalone `OptIn` layer in one doc but inside `Services` subgraph in the other.                                                                                                                                 |
| M-01 | Arch   | `code-quality.md`                                      | Stale package names in Layered Assembly Architecture section: `agent-runtime`, `agent-sessions`, `agent-providers`, `agent-plugins`, `agent-sdk`, `agent-command-*` — all renamed years ago.                                                           |
| M-02 | Dev    | `composition-tree.md`                                  | `App.tsx` render tree incomplete: missing `StreamingIndicator`, `TransportTUI`, `UpdateNotice`, `usePluginCallbacks`, `useStatusLineSettings`, `TuiCliAdapterProvider`. `StatusBar` and `SlashAutocomplete` listed at wrong hierarchy level.           |
| M-03 | Dev    | `composition-tree.md`                                  | `CommandEffectQueue` documented as owned by `tui/command-interaction.ts` (9-line re-export shim) — actual class is in `tui/hooks/command-effect-queue.ts`.                                                                                             |
| M-05 | Dev    | `execution-modes.md`                                   | Print mode sequence diagram shows `new InteractiveSession(...)` but actual code uses `runtime.createSession()`.                                                                                                                                        |
| M-06 | Dev    | `layering-audit.md`                                    | CLI-AUDIT-012 through CLI-AUDIT-023 marked resolved with only a branch name. Evidence policy requires commit hash or PR number. 12 of 23 items violate the policy.                                                                                     |
| M-07 | Dev    | `project-structure.md`                                 | `packages/auth/` and `packages/credits/` listed as existing packages — neither directory exists.                                                                                                                                                       |
| P-C1 | Plan   | architecture-map                                       | `agent-team` has no architecture-map subdocument. Only a 3-line summary in `agent-system.md`. Coordination model, delegation flow, relay protocol undocumented. MULTI-001 backlog is in flight — architecture checkpoint needed before implementation. |
| P-C2 | Plan   | architecture-map                                       | MCP dual role not disambiguated: `agent-tool-mcp` (agent consumes external MCP) vs `agent-transport/mcp` (agent exposed as MCP server) appear side-by-side with no explanation.                                                                        |
| P-C3 | Plan   | `packages/agent-subagent-runner/`                      | **Only package in the repo without `docs/SPEC.md`**. IPC protocol, worker entry contract, opt-in dependency model have no SSOT owner document.                                                                                                         |
| P-M1 | Plan   | architecture-map                                       | `agent-transport` 5 subpaths have no architecture-map document. Diamond dependency structure, React isolation contract, per-subpath consumer mapping undocumented.                                                                                     |
| P-M4 | Plan   | `agent-team/docs/SPEC.md`                              | References `@robota-sdk/agent-event-service` and `agent-sdk` / `agent-sessions` — all renamed packages.                                                                                                                                                |
| P-M6 | Plan   | `agent-web-ui/docs/SPEC.md`                            | References `agent-transport-ws`, `agent-sdk`, `agent-sessions`, `agent-runtime` — all renamed.                                                                                                                                                         |
| P-M5 | Plan   | `cross-cutting-contracts.md`                           | Transport contracts (`ITransportAdapter`, `IConfigurableTransport`) and plugin opt-in contract missing from the contract owner index.                                                                                                                  |

### Minor

| ID    | Source | Finding                                                               |
| ----- | ------ | --------------------------------------------------------------------- |
| mn-01 | Dev    | `composition-tree.md` branch reference stale (branch merged)          |
| mn-02 | Dev    | `commands-and-provider-flow.md` path mismatch for `provider-setup.ts` |
| P-m4  | Plan   | `execution-modes.md` has no coverage of HTTP transport mode           |
| P-m5  | Plan   | Plugin registration contract absent from cross-cutting index          |

---

## Cross-Reviewer Agreement

All 3 reviewers independently flagged these same issues:

- `apps/agent-web-ui/` → `apps/agent-web/` naming error in `project-structure.md`
- Phantom `packages/auth/` and `packages/credits/` in `project-structure.md`
- `composition-tree.md` startup sequence stale

---

## Backlog Items Derived

| Backlog ID   | Title                                                        | Priority | Type   | Hold? |
| ------------ | ------------------------------------------------------------ | -------- | ------ | ----- |
| ARCH-REV-001 | Fix project-structure.md accuracy                            | P1       | Fix    | No    |
| ARCH-REV-002 | Fix dependency-direction.md diagram errors                   | P1       | Fix    | No    |
| ARCH-REV-003 | Fix code-quality.md stale package names                      | P1       | Fix    | No    |
| ARCH-REV-004 | Refresh composition-tree.md (stale post-CLIR)                | P1       | Fix    | No    |
| ARCH-REV-005 | Fix class-interface-inventory.md stale entries               | P1       | Fix    | No    |
| ARCH-REV-006 | Fix execution-modes.md (sidecar + print mode)                | P2       | Fix    | No    |
| ARCH-REV-007 | Add missing evidence to layering-audit.md                    | P2       | Fix    | No    |
| ARCH-REV-008 | Fix stale package names in agent-team + agent-web-ui SPEC.md | P2       | Fix    | No    |
| ARCH-REV-009 | Update cross-cutting-contracts.md missing rows               | P2       | Fix    | No    |
| ARCH-REV-010 | Create agent-subagent-runner/docs/SPEC.md                    | P1       | Create | No    |
| ARCH-REV-011 | Create agent-team architecture-map subdocument               | P2       | Create | No    |
| ARCH-REV-012 | Create transport-architecture.md subdocument                 | P3       | Create | No    |
| ARCH-REV-013 | Expand agent-system.md (MCP + sidecar + playground)          | P2       | Create | No    |

---

## What Is Working Well (Do Not Change)

- Router discipline in `ARCHITECTURE-MAP.md` — thin, clean, no content accumulation
- CLI layering audit evidence policy — replicate this pattern for new subsystems
- `agent-core` zero-dependency constraint is verified and working
- `agent-subagent-runner` dependency isolation (no agent-command/agent-cli deps) — correct
- `agent-interface-transport` and `agent-interface-tui` zero-dep isolation — correct
- `capability-placement.md` decision tables and stop conditions — use these for every new feature
- `dependency-direction.md` `TransportShells ↔ Assembly` bidirectional edge — documented and correct
