# Architecture Map Review — Senior Planner

Reviewed: 2026-05-18
Branch: `develop`
Files reviewed: all 13 specified files plus selected SPEC.md files and backlog items.

---

## Executive Summary

The architecture map is structurally sound and unusually well-organized for a monorepo of this size. The router pattern (`ARCHITECTURE-MAP.md` → topic subdocuments → package `SPEC.md`) is clean, the CLI subsystem is exhaustively documented (23 audit items resolved with evidence), and the dependency-direction rules are precise enough to drive mechanical checks. The primary weakness is asymmetric coverage: the CLI path is deeply documented while equally important subsystems — multi-agent orchestration (`agent-team`), MCP transport server mode, transport subpath contracts, the playground stack, and the WebSocket sidecar — receive only summary paragraphs. A new senior developer can orient quickly, but cannot make informed decisions in those under-documented areas without reading scattered SPEC.md files that are not linked from the architecture map.

---

## Documentation Strengths

1. **Router discipline is excellent.** `ARCHITECTURE-MAP.md` is a true thin router: 9 numbered reading order steps, a concise document tree, and a clear update-requirement policy. It does not accumulate detail — detail consistently lives in the right subdocument.

2. **CLI architecture is the best-documented subsystem in the repo.** Six focused files under `agent-cli/`, a router (`agent-cli-composition.md`), a composition tree with a concrete line-by-line startup path, a class/interface inventory with owner-layer columns, and 23 audit findings all with resolution evidence. This is the reference quality bar for all other subsystems.

3. **Capability placement and dependency direction are actionable.** `capability-placement.md` and `dependency-direction.md` contain decision tables and stop conditions that prevent ownership drift without requiring the reader to understand the whole system first. The "lowest reusable boundary" rule is clearly stated and applied consistently.

4. **Cross-cutting contracts index is well-structured.** The contract owner index in `cross-cutting-contracts.md` routes cleanly to functional specs, package SPECs, and the OpenAPI file. The mermaid diagram grouping (Domain, Functional, Server) makes the contract landscape scannable.

5. **Architecture lessons enforce evidence discipline.** The `architecture-lessons.md` evidence policy (commit hash or PR required before marking resolved) prevents paperwork-only closures. This pattern should be replicated in multi-agent and transport area documents.

6. **All but one package has a SPEC.md.** 17 of 18 packages have a `docs/SPEC.md`. `agent-subagent-runner` is the sole exception.

---

## Gaps Found

### Critical (missing coverage that blocks onboarding or decision-making)

| ID   | Area                                                       | Gap                                                                                                                                                                                                                                                                                                                                                                                                                                         | Impact                                                                                                                                                                                          |
| ---- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-01 | Multi-agent orchestration                                  | `agent-team` has no architecture-map subdocument. `agent-system.md` has 3 lines and one ownership table row. The coordination model, delegation flow, relay protocol, template registry, and owner-path propagation pattern are undocumented at the architecture-map level.                                                                                                                                                                 | A developer changing multi-agent delegation cannot find the architecture contract without diving directly into SPEC.md and source; no arch-map step guides them there.                          |
| C-02 | MCP transport server mode                                  | `agent-transport/mcp` is listed in layer diagrams as a subpath label only. There is no architecture-map document explaining how the MCP server adapter exposes `InteractiveSession` to MCP clients, what the protocol boundary is, or how it differs from the `agent-tool-mcp` tool-use integration. Two distinct MCP roles (server transport vs tool client) exist in the codebase but are not disambiguated in any architecture-map file. | Developers conflate the MCP transport server (exposing the agent as an MCP server) with MCP tool integration (agent consuming external MCP tool servers), leading to wrong ownership decisions. |
| C-03 | `agent-subagent-runner` has no SPEC.md                     | This is the only package in the repository without a `docs/SPEC.md`. Its architecture is documented solely through CLI audit items (CLI-AUDIT-022 in `layering-audit.md`) and class inventory rows. The package's own boundary — what it owns, what it forbids, its IPC protocol — has no owner document.                                                                                                                                   | Any change to the subagent runner has no SSOT to validate against. Boundary drift is undetectable by harness without a SPEC.                                                                    |
| C-04 | `apps/agent-web-ui` naming error in `project-structure.md` | `project-structure.md` line 25 says `apps/agent-web-ui/` but the actual filesystem directory is `apps/agent-web/`. This stale name is the first package-listing document a new developer reads.                                                                                                                                                                                                                                             | A developer following the architecture docs to find the web app navigates to a non-existent path, eroding trust in the documentation accuracy of the entire map.                                |

### Major (significant gaps)

| ID   | Area                                                                                    | Gap                                                                                                                                                                                                                                                                                                                                                                                                   | Impact                                                                                                                                                                                                                                      |
| ---- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M-01 | Transport subpath architecture                                                          | `agent-transport` has 5 production subpaths (`/headless`, `/http`, `/ws`, `/mcp`, `/tui`) each with distinct protocol semantics, dependency constraints, and consumer contracts. There is no architecture-map document for this package family. The SPEC.md covers scope but the architecture-map has only label-level mentions in layer diagrams.                                                    | Developers adding a new transport mode, changing the WebSocket protocol, or wiring HTTP routing must navigate to the package SPEC.md directly — no arch-map reading step routes them there.                                                 |
| M-02 | Playground stack under-documented                                                       | `agent-system.md` has a playground stack flowchart and 4-row ownership table but no documented data flow for the browser-agent server communication path, no explanation of how `PlaygroundExecutor` maps to `RemoteExecutor`, and no discussion of the intentional "no session stack" architectural decision beyond a single paragraph. The `agent-remote-client` role is mentioned only as a label. | The playground is a user-facing product surface. Developers modifying `agent-playground`, `agent-remote-client`, or `apps/agent-server` have no arch-map checkpoint for their changes.                                                      |
| M-03 | WebSocket sidecar mode absent from architecture map                                     | The `--web` sidecar execution mode (CLI + `agent-web-ui` browser monitor) is documented in `execution-modes.md` (sequenceDiagram, source file ref) but not registered in `agent-system.md`, `apps-and-deployment.md`, or `cross-cutting-contracts.md`. `apps-and-deployment.md` mentions `agent-web-ui` in the disambiguation table but does not document the sidecar flow or the `/monitor` route.   | The sidecar is a cross-cutting feature touching `agent-cli`, `agent-transport/ws`, `agent-web-ui`, and `apps/agent-web`. A developer changing any leg of this flow has no single architecture-map document that connects all four packages. |
| M-04 | `agent-team` SPEC.md references stale package names                                     | `agent-team/docs/SPEC.md` (Boundaries section) references `@robota-sdk/agent-event-service` and `@robota-sdk/agent-sdk` — packages that have been renamed. The class-interface-inventory in `agent-cli/` documents the rename map, but the SPEC.md for `agent-team` was not updated.                                                                                                                  | Architecture conformance between the spec and codebase cannot be verified mechanically if the SPEC.md references non-existent package names.                                                                                                |
| M-05 | `cross-cutting-contracts.md` missing transport contract row                             | The contract owner index does not have a row for transport protocol contracts (`ITransportAdapter`, `IConfigurableTransport`, the 5 subpath boundary contracts). These are cross-cutting contracts consumed by `agent-cli`, `agent-framework`, all transport shells, and `apps/agent-web`.                                                                                                            | The index is the first place a developer looks for "who owns this contract." Missing transport rows cause them to independently rediscover the answer or violate the boundary.                                                              |
| M-06 | Auth and credits packages listed but non-existent                                       | `project-structure.md` lists `packages/auth/` and `packages/credits/` with descriptions. Neither directory exists in the filesystem. `capability-placement.md` marks their owner as "TBD — packages not yet created." The gap between the listing and reality is not surfaced clearly.                                                                                                                | A developer reading `project-structure.md` believes auth and credits packages exist and may attempt to import from them. The TBD note in `capability-placement.md` is a separate document that a reader may not reach.                      |
| M-07 | ARCHITECTURE-MAP.md reading order has no step for multi-agent, transport, or playground | The 9-step reading order in `ARCHITECTURE-MAP.md` routes to CLI detail (step 6) but does not have dedicated steps for multi-agent changes, transport protocol changes, or playground stack changes. Step 5 mentions "transports, playground, or remote execution" but routes everything to `agent-system.md`, which has only summary coverage of those areas.                                         | Developers making multi-agent or transport changes follow step 5, find a summary paragraph, and must self-navigate to SPEC.md files — increasing the chance of missed boundary rules.                                                       |

### Minor (nice-to-have improvements)

| ID   | Area                                                                     | Gap                                                                                                                                                                                                                                           | Impact                                                                                                                                                                                               |
| ---- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| m-01 | `architecture-lessons.md` is sparse                                      | Only 3 resolved audit items are recorded. The CLI layering audit (`layering-audit.md`) has 23 resolved items with full evidence. The system-level lessons file should be the canonical record for system-wide architectural decisions.        | History of system-level choices (e.g., why TUI was re-integrated into `agent-transport`, the ComfyUI-compatible Runtime API freeze) is not surfaced.                                                 |
| m-02 | `agent-system.md` API boundary table lacks detail                        | The Runtime/Orchestrator API boundary table (2 rows) states "ComfyUI-compatible" for the runtime API but provides no link, no field listing, and no change policy beyond "must not be modified."                                              | Developers cannot verify what the Runtime API surface is without searching the codebase.                                                                                                             |
| m-03 | `apps-and-deployment.md` has no diagram for the sidecar+browser topology | The deployment table lists `apps/agent-web` and `apps/agent-server` separately but does not show how the CLI sidecar (`--web` flag) connects to `agent-web-ui` and `apps/agent-web` in a separate channel from the playground WebSocket path. | Two WebSocket flows (playground WebSocket via `agent-server`, and CLI sidecar WebSocket via local port) share the same browser app but serve different purposes. This distinction is not diagrammed. |
| m-04 | `agent-cli/execution-modes.md` does not cover HTTP transport mode        | The document covers TUI interactive, headless print, and WebSocket sidecar. `agent-transport/http` is an available transport but has no execution-mode entry.                                                                                 | Developers cannot determine if HTTP transport has an associated CLI flag or if it is server-only.                                                                                                    |
| m-05 | Plugin registration contract absent from cross-cutting index             | `agent-plugin` is listed in layer diagrams as opt-in but the `cross-cutting-contracts.md` index has no row pointing to the plugin registration contract, event subscription model, or the "consumer opt-in" composition rule.                 | The opt-in pattern is documented in `agent-system.md` prose but not indexed as a contract.                                                                                                           |
| m-06 | `agent-web-ui/docs/SPEC.md` has stale package boundary references        | References `agent-transport-ws` (stale name) and `agent-sdk`/`agent-sessions`/`agent-runtime` (all renamed). The class-interface-inventory package rename map covers these, but the SPEC itself is not updated.                               | Lowers confidence in SPEC accuracy for this package, and may cause misrouted imports in new code.                                                                                                    |

---

## Detailed Findings

### C-01 — Multi-Agent Orchestration Documentation Gap

`agent-system.md` (lines 122–131) has one paragraph and one table row for multi-agent:

> `agent-team` owns multi-agent task delegation and coordination… below `agent-framework` but above `agent-core`.

Note: `agent-team` package was deleted (TOOL-003, PR #634). Multi-agent delegation via
relay tools has been removed. The `agent-team` gap finding below is superseded.

The backlog item ARCH-FIX-004 (completed) added `agent-team` and `agent-remote-client` to the layer diagrams, but only at label level. No subdocument was produced.

### C-02 — MCP Transport vs MCP Tool Disambiguation

The architecture map uses "MCP" to refer to two distinct things:

- `agent-tool-mcp` (`agent-tools + agent-tool-mcp` in `agent-system.md`) — the agent consuming external MCP tool servers as tools.
- `agent-transport/mcp` (listed in layer diagrams) — the agent being exposed as an MCP server to MCP clients.

These appear side-by-side in diagram labels (`agent-tools · agent-tool-mcp` and `agent-transport/…/mcp`) with no prose distinguishing them. No architecture-map document explains the MCP server transport: what it exposes, what clients connect to it, how `InteractiveSession` is mapped to MCP protocol primitives, or when a developer would use one vs the other.

### C-03 — `agent-subagent-runner` Has No SPEC.md

The package was created as part of ARCH-FIX-022 / CLI-AUDIT-022 (branch `refactor/arch-002-slim-agent-cli`, 2026-05-17). It is documented in `class-interface-inventory.md` (6 rows) and `layering-audit.md` (full resolution entry). However, no `docs/SPEC.md` was created as part of that work. The package owns IPC protocol types, the worker entry point, the worker path resolver, and the optional dependency model — all of which are cross-cutting concerns requiring a SSOT owner document.

### C-04 — `apps/agent-web-ui` Naming Error

`project-structure.md` line 25: `apps/agent-web-ui/ # Web application (Agent Playground)`.
Actual filesystem: `apps/agent-web/`.

This is a direct contradiction between the primary package-listing document and reality. The correct name (`apps/agent-web`) is used consistently in `apps-and-deployment.md` and `agent-system.md`, so this error is isolated to `project-structure.md` but it is in the first document a new developer reads.

### M-01 — Transport Subpath Architecture Has No Map Document

`agent-transport` consolidates 5 subpaths, each with different React dependency constraints, protocol semantics, and consumer sets. The SPEC.md documents scope, dependency table, and migration notes. But there is no architecture-map document for this package family.

Specifically missing from the architecture map:

- The diamond dependency structure (`agent-core ← agent-framework ← agent-transport`, `agent-core ← agent-interface-transport ← agent-transport`) and why `agent-framework` and `agent-transport` must never import each other.
- The protocol boundary for each subpath and which product shells consume each.
- The React isolation contract: which subpaths are pure-TS, which carry React/Ink.

The ARCHITECTURE-MAP.md step 5 says "read agent-system.md before changing… transports" but `agent-system.md` has no section that covers transport architecture beyond listing them.

### M-02 — Playground Stack Needs Expanded Coverage

`agent-system.md` has the playground flowchart and ownership table (lines 88–121) but the following are absent:

- Data flow for the browser → `apps/agent-web` → `apps/agent-server` → AI provider path.
- Where `PlaygroundWebSocketClient` fits relative to the sidecar WebSocket (`agent-transport/ws`).
- Why `agent-playground` intentionally has no `agent-framework` / `agent-session` dependency (the SPEC.md documents this as an ADR, the architecture map should reference it).
- The `agent-remote-client` role in keeping API keys server-side.

### M-03 — WebSocket Sidecar Is Not Cross-Referenced

The WebSocket sidecar feature (`--web`) spans:

- `agent-cli` (`startWebSidecarServer`) — documented in `execution-modes.md`
- `agent-transport/ws` (`createWsHandler`) — documented in `agent-transport` SPEC
- `agent-web-ui` (browser React components) — documented in `agent-web-ui` SPEC
- `apps/agent-web` (`/monitor` route) — mentioned in deployment table

No architecture-map document connects all four. ARCH-FIX-007 (high priority) was raised to register this feature but the backlog file was not found in active backlog (may be completed). The `apps-and-deployment.md` disambiguation table mentions the packages separately but does not draw the sidecar flow.

### M-04 — `agent-team` SPEC.md Has Stale Package References

The Boundaries section references `@robota-sdk/agent-event-service` (removed package) and uses "agent-sdk" / "agent-sessions" (old names). The class-interface-inventory documents the correct rename map but the SPEC.md was not updated as part of ARCH-CONF-008 (which is in `completed/`). This creates a verified SSOT inconsistency.

### M-06 — `agent-web-ui` SPEC.md Has Stale References

`packages/agent-web-ui/docs/SPEC.md` Boundaries section references:

- `@robota-sdk/agent-transport-ws` (old name → now `@robota-sdk/agent-transport/ws`)
- `agent-sdk`, `agent-sessions`, `agent-runtime` (all renamed)

The SPEC is otherwise well-structured (scope, boundaries, architecture, type ownership) but the stale package names undermine SSOT confidence.

---

## Recommended New Documents / Expansions

Listed in priority order.

| Priority     | Document                                                         | Path                                                                                   | Rationale                                                                                                                                                                                                                                          |
| ------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 (Critical) | Multi-agent orchestration map                                    | `.agents/specs/architecture-map/agent-team.md`                                         | Cover delegation model, relay tool protocol, owner-path propagation, composition entry points, and what distinguishes `agent-team` from `agent-subagent-runner`. Link from `agent-system.md` and add step 5a to ARCHITECTURE-MAP.md reading order. |
| 2 (Critical) | `agent-subagent-runner` SPEC.md                                  | `packages/agent-subagent-runner/docs/SPEC.md`                                          | Create the missing SSOT for IPC protocol, worker entry contract, opt-in dependency model, and boundary with `agent-executor`. Required for harness SPEC coverage.                                                                                  |
| 3 (Critical) | Fix `project-structure.md` naming                                | `.agents/project-structure.md` line 25                                                 | Change `apps/agent-web-ui/` to `apps/agent-web/` (one-line fix, high visibility).                                                                                                                                                                  |
| 4 (Major)    | MCP transport vs MCP tool disambiguation                         | `.agents/specs/architecture-map/mcp-architecture.md` or expansion of `agent-system.md` | Separate sections for (a) `agent-tool-mcp` as tool-use consumer of external MCP servers, and (b) `agent-transport/mcp` as a server adapter exposing `InteractiveSession` to MCP clients. Add a reading order step for MCP server changes.          |
| 5 (Major)    | Transport subpath architecture map                               | `.agents/specs/architecture-map/transport-architecture.md`                             | Document the diamond dependency structure, React isolation contract, protocol boundary for each subpath, and which product shells consume which subpath. Link from step 5 in ARCHITECTURE-MAP.md.                                                  |
| 6 (Major)    | WebSocket sidecar cross-reference                                | Expand `apps-and-deployment.md` and `agent-system.md`                                  | Add a "WebSocket Sidecar (`--web` mode)" section in `agent-system.md` that connects CLI → `agent-transport/ws` → `agent-web-ui` → `apps/agent-web`. Reference `execution-modes.md` for the sequence diagram.                                       |
| 7 (Major)    | Add transport contract row to `cross-cutting-contracts.md`       | `.agents/specs/architecture-map/cross-cutting-contracts.md`                            | Add a row for `agent-interface-transport` as the transport contract owner. Add a row for `agent-plugin` opt-in composition contract.                                                                                                               |
| 8 (Major)    | Fix auth/credits gap in `project-structure.md`                   | `.agents/project-structure.md`                                                         | Either remove the auth/credits rows and add a "Planned: not yet created" note at the end, or add a clear `[PLANNED]` label inline. Sync with `capability-placement.md` TBD note.                                                                   |
| 9 (Major)    | Fix stale package names in `agent-team` and `agent-web-ui` SPECs | `packages/agent-team/docs/SPEC.md`, `packages/agent-web-ui/docs/SPEC.md`               | Update all references from `agent-event-service`, `agent-sdk`, `agent-sessions`, `agent-runtime`, `agent-transport-ws` to their current package names.                                                                                             |
| 10 (Minor)   | Playground architecture expansion in `agent-system.md`           | `.agents/specs/architecture-map/agent-system.md`                                       | Add a data-flow description of browser → `apps/agent-web` → REST/WebSocket → `apps/agent-server` → provider, and explicitly link to the `agent-playground` SPEC's ADR for the intentional no-session-stack decision.                               |
| 11 (Minor)   | HTTP transport execution mode in `execution-modes.md`            | `.agents/specs/architecture-map/agent-cli/execution-modes.md`                          | Add a note clarifying whether `agent-transport/http` has a CLI flag or is server-composition-only.                                                                                                                                                 |
| 12 (Minor)   | `architecture-lessons.md` system-level history                   | `.agents/specs/architecture-map/architecture-lessons.md`                               | Migrate high-value system decisions (TUI re-integration into `agent-transport`, Runtime API freeze, consolidation of `agent-command-*` to single `agent-command` package) from SPEC files and commit history into this file.                       |

---

## Recommendations Summary

Prioritized action list:

1. **Fix the `apps/agent-web-ui` naming error in `project-structure.md`** — one-line change, highest visibility to new developers, zero risk.

2. **Create `packages/agent-subagent-runner/docs/SPEC.md`** — the only package without a SSOT. Required for harness coverage. Can be bootstrapped from `layering-audit.md` CLI-AUDIT-022 content.

3. **Fix stale package names in `agent-team/docs/SPEC.md` and `agent-web-ui/docs/SPEC.md`** — both reference renamed packages. Quick find-and-replace using the rename map in `class-interface-inventory.md`.

4. **Create `.agents/specs/architecture-map/agent-team.md`** — multi-agent is a named product feature (MULTI-001 backlog item is in flight). Document before implementing the TUI multiplexer so architecture decisions have a map checkpoint.

5. **Add MCP disambiguation section to `agent-system.md`** — two-paragraph prose and a table distinguishing `agent-tool-mcp` (tool consumer) from `agent-transport/mcp` (server adapter). No new file required.

6. **Add transport contract row to `cross-cutting-contracts.md`** — point to `agent-interface-transport` as the transport contract SSOT. Also add plugin opt-in contract row.

7. **Clarify auth/credits status in `project-structure.md`** — mark planned-but-not-created packages clearly to prevent false import attempts.

8. **Create `.agents/specs/architecture-map/transport-architecture.md`** — document diamond dependency, React isolation, and per-subpath consumer mapping. Add a reading order step 5a in `ARCHITECTURE-MAP.md` for transport changes.

9. **Add WebSocket sidecar cross-reference in `agent-system.md`** — a single "WebSocket Sidecar Mode" section connecting the four packages involved.

10. **Expand playground data-flow in `agent-system.md`** — document the browser-to-server path and link to the `agent-playground` SPEC ADR for the no-session-stack decision.
