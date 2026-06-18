# Architecture Conformance Audit — 2026-06-19

Orchestrated via `architecture-conformance-audit` (INFRA-002 schema). Read-only doc-vs-code
verification of all 40 canonical documents (17 architecture-map docs + 23 package SPEC.md),
each claim assigned a verdict with `file:line` evidence by 7 parallel verifiers.

## 1. Method

**Verdict vocabulary:** HOLDS (matches code) · DRIFT (directionally right but stale/incomplete) ·
VIOLATION (code contradicts the claim) · CONTRADICTION (two docs, or a doc vs its own diagram,
conflict) · STALE (references something that no longer / does not yet exist).

**Severity:** P0 = rule violation or authority-doc contradiction that actively misleads about
boundaries/contracts. P1 = real drift (phantom symbols, stale ownership, broken diagrams,
undocumented contracts). P2 = cosmetic / minor naming / incompleteness.

## 2. Mechanical Conformance Baseline

- `pnpm harness:conformance` → **PASS**. JSON: `dependencyDirection: pass`,
  `packageNameViolations: 0`, `unknownPackageTokens: []`, `conformant: true`.
- `pnpm harness:scan` → **all 26 scans pass** (consistency, document-authority, deps, specs,
  build-contracts, dist, docs-structure, conformance, …).

No mechanical issue reported → no finding originates from the mechanical floor. The findings
below are all from the analytic doc-claim layer on top of a passing mechanical baseline.

## 3. Dependency Graph Ground Truth

`@robota-sdk/*` edge set (from each `package.json`); 23 packages; 0 direction violations:

```
agent-core               -> (zero-dep)
agent-interface-tui      -> (zero-dep)
agent-executor           -> core
agent-provider           -> core
agent-session            -> core
agent-plugin             -> core
agent-tools              -> core (peer)
agent-tool-mcp           -> core (peer)
agent-remote-client      -> core
agent-preset             -> framework
agent-session-analytics  -> core, interface-transport
agent-interface-transport-> core, executor, session (type-only)
agent-framework          -> core, executor, interface-transport, session, tools
agent-subagent-runner    -> core, executor, framework, provider
agent-command            -> core, framework, interface-transport, preset
agent-transport          -> core, framework, interface-transport
agent-transport-ws       -> core, framework, interface-transport
agent-transport-tui      -> core, framework, interface-transport, interface-tui
agent-transport-http     -> interface-transport
agent-transport-mcp      -> interface-transport
agent-playground         -> core, provider, remote-client, tools
agent-web-ui             -> transport-ws
agent-cli                -> command, core, framework, preset, provider, session-analytics, subagent-runner, transport, transport-tui, transport-ws
```

All declared edges were confirmed as actual production imports (verifiers checked source, not
just manifests). The dependency direction is clean — every finding below is a **documentation**
defect, not a dependency violation.

## 4. Per-Document Verdict Summary

### Architecture-map (17)

| Document                                  | Overall        | Findings                                                       |
| ----------------------------------------- | -------------- | -------------------------------------------------------------- |
| `architecture-map/README.md`              | HOLDS          | —                                                              |
| `apps-and-deployment.md`                  | HOLDS          | — (cleanest map doc; all app package names verified)           |
| `architecture-lessons.md`                 | HOLDS          | — (referenced artifacts exist; commit hashes not git-verified) |
| `cross-cutting-contracts.md`              | HOLDS          | — (auth/credits correctly caveated "planned")                  |
| `agent-system.md`                         | DRIFT          | AF-04                                                          |
| `dependency-direction.md`                 | DRIFT          | AF-05                                                          |
| `capability-placement.md`                 | DRIFT          | AF-06                                                          |
| `agent-cli-composition.md`                | DRIFT          | AF-07                                                          |
| `repository-overview.md`                  | STALE          | AF-03                                                          |
| `transport-architecture.md`               | VIOLATION      | AF-01, AF-08                                                   |
| `agent-cli/README.md`                     | HOLDS          | —                                                              |
| `agent-cli/execution-modes.md`            | HOLDS          | — (planned WS-sidecar correctly self-flagged)                  |
| `agent-cli/class-interface-inventory.md`  | DRIFT (severe) | AF-02, AF-09                                                   |
| `agent-cli/composition-tree.md`           | DRIFT (severe) | AF-09, AF-10, AF-11                                            |
| `agent-cli/commands-and-provider-flow.md` | DRIFT          | AF-09                                                          |
| `agent-cli/layering-audit.md`             | DRIFT          | AF-10                                                          |
| `agent-cli/target-architecture.md`        | DRIFT          | AF-18                                                          |

### Package SPEC.md (23)

| SPEC                      | Overall               | Findings                               |
| ------------------------- | --------------------- | -------------------------------------- |
| agent-core                | HOLDS                 | AF-19                                  |
| agent-executor            | HOLDS                 | —                                      |
| agent-framework           | HOLDS                 | —                                      |
| agent-command             | HOLDS                 | —                                      |
| agent-cli                 | HOLDS                 | AF-12                                  |
| agent-transport           | HOLDS                 | — (1 minor DRIFT, folded into AF note) |
| agent-transport-http      | HOLDS                 | —                                      |
| agent-transport-ws        | HOLDS                 | —                                      |
| agent-transport-mcp       | HOLDS                 | —                                      |
| agent-transport-tui       | HOLDS                 | —                                      |
| agent-interface-transport | DRIFT                 | AF-13                                  |
| agent-interface-tui       | HOLDS                 | —                                      |
| agent-provider            | HOLDS                 | AF-20                                  |
| agent-session             | DRIFT + CONTRADICTION | AF-14, AF-25                           |
| agent-session-analytics   | HOLDS                 | —                                      |
| agent-tools               | DRIFT                 | AF-16, AF-23, AF-24                    |
| agent-tool-mcp            | DRIFT                 | AF-15, AF-21                           |
| agent-plugin              | HOLDS                 | —                                      |
| agent-remote-client       | HOLDS                 | AF-26                                  |
| agent-subagent-runner     | HOLDS                 | —                                      |
| agent-preset              | HOLDS                 | —                                      |
| agent-playground          | DRIFT                 | AF-17                                  |
| agent-web-ui              | HOLDS                 | AF-22                                  |

Coverage: all 40 canonical docs reviewed; no silent scoping. Caveats — sibling `.md` links and
commit hashes referenced by `cross-cutting-contracts.md`/`architecture-lessons.md`/README routers
were not exhaustively existence-checked (info-level).

## 5. Findings

### P0 (2)

- **AF-01 — VIOLATION — `transport-architecture.md`.** Its central thesis ("`@robota-sdk/agent-transport`
  exports 5 production subpaths: headless/http/ws/mcp/tui") contradicts reality: `agent-transport`
  exports only `.`, `./headless`, `./testing` (`packages/agent-transport/package.json`), and
  `tui/ws/http/mcp` are **separate packages** (`packages/agent-transport-{tui,ws,http,mcp}/`). Most
  subpath claims (`/tui` Ink owner, `/http` Hono, `/ws`, `/mcp`, `ITuiCliAdapter` at
  `agent-transport/src/tui/...`, `Transport → IfaceTui`) are violations/stale. Authority doc
  actively misleads about package boundaries.
- **AF-02 — CONTRADICTION + STALE — `agent-cli/class-interface-inventory.md`.** Header package-map
  asserts the **reverse** migration `agent-transport-tui → agent-transport (subpath /tui)`,
  contradicted by `packages/agent-cli/package.json` (separate `@robota-sdk/agent-transport-tui`,
  `-ws` deps) and `agent-cli/src/cli.ts:33,35` (imports from those packages). 10 inventory rows are
  STALE — every TUI symbol (`TuiTransport`, `renderApp`, `App`, `TuiInteractionChannel`,
  `useTuiChannel`, `useSlashRouting`, `useSideEffects`, `CommandEffectQueue`, `TuiStateManager`)
  cited at a nonexistent `agent-transport/src/tui/...` path; actual home is
  `packages/agent-transport-tui/src/...`.

### P1 (16)

- **AF-03 — STALE — `repository-overview.md`.** Package inventory predates the transport split:
  lists `agent-transport (subpaths /tui,/ws,/http,/mcp)` as one package and omits the four real
  `agent-transport-*` packages and `agent-session-analytics`.
- **AF-04 — DRIFT — `agent-system.md`.** `TuiTransport` modeled as `agent-transport/tui` subpath;
  `createWsHandler` cited at `packages/agent-transport/src/ws/ws-handler.ts:51` is STALE (actual
  `packages/agent-transport-ws/src/ws-handler.ts`); mermaid omits the real
  `agent-command → agent-interface-transport` edge.
- **AF-05 — DRIFT — `dependency-direction.md`.** `TransportShells` node enumerates subpaths that are
  now separate packages; diagram edge `Orchestration(agent-remote-client) → Adapters` has no
  package backing (`agent-remote-client` deps = core only).
- **AF-06 — DRIFT — `capability-placement.md`.** Owner table uses `agent-transport` subpath phrasing;
  `auth`/`credits` rows cite "their package SPEC files" without the "planned" caveat (no such packages).
- **AF-07 — DRIFT — `agent-cli-composition.md`.** Governance section cites
  `agent-transport/src/tui/hooks/{useInteractiveSession,useSlashRouting,useSideEffects}.ts` — all
  STALE; actual `packages/agent-transport-tui/src/hooks/`.
- **AF-08 — VIOLATION — `transport-architecture.md`.** Type Contract Ownership claims
  `agent-interface-tui` is "consumed by … `agent-command`". `agent-command/package.json` has no
  `agent-interface-tui` dependency (consumed only by `agent-transport-tui`).
- **AF-09 — VIOLATION (×3, one root cause) — `class-interface-inventory.md`, `composition-tree.md`,
  `commands-and-provider-flow.md`.** `createModelCommandModule` / `agent-command/src/model/` do
  **not exist** (no `model/` dir, no symbol in `agent-command/src`). The real default module set
  (`agent-command/src/default/default-command-modules.ts:74-92`) has no model module and adds
  mode/preset/schedule/settings modules the docs omit.
- **AF-10 — CONTRADICTION — `composition-tree.md`, `layering-audit.md` (CLI-AUDIT-011/019).**
  `createDefaultTransportRegistry` is documented as extracted to `@robota-sdk/agent-transport`, but
  it is a **local helper in `agent-cli/src/cli.ts:62-66`** (not exported from agent-transport). This
  also falsifies the "`cli.ts` defines no behavior helper functions / is 316 lines" claim (actual
  329 lines).
- **AF-11 — DRIFT — `composition-tree.md`.** Command-module list omits
  `createMode/Preset/Schedule/Settings CommandModule` and misplaces `createProviderCommandModule`
  (it is inside `createDefaultCommandModules`, not appended in `cli.ts`).
- **AF-12 — CONTRADICTION — `agent-cli/docs/SPEC.md:710`.** Says `TuiInteractionChannel` is owned by
  `@robota-sdk/agent-transport`; the class lives only in
  `packages/agent-transport-tui/src/TuiInteractionChannel.ts` — contradicting the same SPEC's own
  composition diagram (line 278) which places it under `agent-transport-tui`.
- **AF-13 — STALE — `agent-interface-transport/docs/SPEC.md`.** Claims `agent-framework` owns and
  implements `TransportRegistry`; the only `class TransportRegistry` is in
  `agent-transport/src/transport-registry.ts:18` (and has no declared `implements` clause —
  structurally compatible only). Also describes implementors as `agent-transport/*` subpaths (now
  separate packages).
- **AF-14 — CONTRADICTION — `agent-session/docs/SPEC.md`.** (a) `TPermissionResult` documented as
  `boolean | 'allow-session'`; actual `permission-types.ts:18` adds `'allow-project'`. (b)
  `ITerminalOutput`/`ISpinner` listed as package-owned SSOT types, but `permission-types.ts:7,9`
  re-exports them from `@robota-sdk/agent-core` (core owns them). Type-Ownership File column also
  stale (types live in `permission-types.ts`/`session-types.ts`, not `permission-enforcer.ts`/`session.ts`).
- **AF-15 — CONTRADICTION — `agent-tool-mcp/docs/SPEC.md:5`.** "published to npm under
  `@robota-sdk/agent-tool-mcp`" — but `package.json` has `"private": true` (not published).
- **AF-16 — VIOLATION — `agent-tools/docs/SPEC.md`.** `classifyFetchError` listed in the Public API
  Surface, but `src/index.ts` does not re-export it (only in `src/builtins/index.ts`, which is not
  surfaced at the package entry). Not reachable from `@robota-sdk/agent-tools`.
- **AF-17 — VIOLATION + STALE — `agent-playground/docs/SPEC.md`.** `IPlaygroundBootState` (line 69)
  does not exist anywhere in `src`. `usePlaygroundBoot`, `PlaygroundAgentSession`, `usePlaygroundData`
  are STALE (replaced by split context hooks / decomposed files). `PLAYGROUND_STATISTICS_EVENTS` is
  declared `const`, not `export const` (DRIFT — listed as owned export).
- **AF-18 — DRIFT — `agent-cli/target-architecture.md`.** Dependency-graph mermaid omits the real
  `CLI → agent-executor` edge (`cli.ts:36` imports `createDefaultBackgroundTaskRunners`; executor is
  a dep) and models transport as a single node with tui/ws/http/mcp subpaths (separate packages).

### P2 (8)

- **AF-19 — DRIFT — `agent-core/docs/SPEC.md`.** Hook executors cited as `hooks/command-executor.ts` /
  `hooks/http-executor.ts`; actual `hooks/executors/command-executor.ts` / `hooks/executors/http-executor.ts`.
- **AF-20 — DRIFT — `agent-provider/docs/SPEC.md`.** `tsdown` builds `dist/browser` (ESM browser
  platform), but `package.json` `exports` has no `browser` condition — bundle built, not consumer-resolvable.
- **AF-21 — DRIFT — `agent-tool-mcp/docs/SPEC.md`.** SPEC asserts `RelayMcpTool implements ITool` (×3);
  `relay-mcp-tool.ts:46` declares the class with no `implements` clause (only a doc-comment). `MCPTool`
  does implement it correctly.
- **AF-22 — CONTRADICTION (minor) — `agent-web-ui/docs/SPEC.md`.** Class Contract Registry says
  `AgentActivityPanel.tsx` carries `'use client'`; the file has no such directive (the other two
  components do).
- **AF-23 — STALE — `agent-tools/docs/SPEC.md`.** Production deps "Production (2)" (`fast-glob`, `zod`);
  actual 3 — `p-limit` (used in `builtins/glob-tool.ts`) is undocumented.
- **AF-24 — DRIFT — `agent-tools/docs/SPEC.md`.** `IWorkspaceManifest` consumer cited at
  `interactive-session-init.ts`; the type import is in `interactive-session-options.ts:29`.
- **AF-25 — DRIFT — `agent-session/docs/SPEC.md`.** `ICompactEvent`/`TCompactTrigger` are exported
  (`index.ts:7,8`) but absent from the Public API Surface table (undocumented public surface).
- **AF-26 — DRIFT (minor) — `agent-remote-client/docs/SPEC.md`.** `server.ts` described as "empty stub";
  it contains a JSDoc header (exports nothing — intent holds).

## 6. Counts by Severity

| Severity  | Count  | IDs           |
| --------- | ------ | ------------- |
| P0        | 2      | AF-01, AF-02  |
| P1        | 16     | AF-03 … AF-18 |
| P2        | 8      | AF-19 … AF-26 |
| **Total** | **26** |               |

(Mechanical baseline contributed 0 findings; dependency direction is clean.)

## 7. Headline Conclusions

1. **The mechanical floor is green** — dependency direction, package naming, and all 26 harness
   scans pass. Every finding is a documentation defect, not a code/boundary violation.
2. **One systemic root cause dominates (AF-01..AF-08, AF-10..AF-13, AF-18 ≈ half the findings):**
   the **transport-layer split** — what the docs describe as a single `agent-transport` package with
   `tui/ws/http/mcp` subpaths is actually **five separate packages**. Several authority docs
   (`transport-architecture.md`, the agent-cli inventory, `agent-interface-transport` SPEC) describe
   the pre-split world; one (`class-interface-inventory.md`) even states the migration in reverse.
3. **A small cluster of phantom/stale symbols** (`createModelCommandModule`, `IPlaygroundBootState`,
   `usePlaygroundBoot`, `PlaygroundAgentSession`, `classifyFetchError` not exported) left behind by
   refactors — easy STALE/VIOLATION fixes.
4. **Two genuine contract inaccuracies worth prompt fixes:** `agent-session` `TPermissionResult`
   missing `'allow-project'` and the `ITerminalOutput`/`ISpinner` ownership mis-attribution (AF-14);
   `agent-tool-mcp` "published" vs `private: true` (AF-15).
5. **Cleanest areas:** `agent-executor`, `agent-framework`, `agent-command`, `agent-preset`,
   `agent-plugin`, `agent-subagent-runner`, `agent-session-analytics`, and the four
   `agent-transport-{http,ws,mcp,tui}` SPECs are fully conformant; `apps-and-deployment.md` and
   `execution-modes.md` (including a correctly self-flagged "planned" section) are the model docs.

Remediation mapping → `improvement-proposal.md`.
