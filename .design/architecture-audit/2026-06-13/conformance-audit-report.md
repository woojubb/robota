# Architecture Conformance Audit Report

> **Backlog:** INFRA-002 · **Date:** 2026-06-13 · **Branch:** `feat/INFRA-002-architecture-conformance-audit`
> **Scope:** read-only doc-vs-code conformance audit. No production code changed.

## 1. Method

For every canonical architecture document, each concrete structural claim was checked against code
reality and assigned a verdict:

| Verdict           | Meaning                                                          |
| ----------------- | ---------------------------------------------------------------- |
| **HOLDS**         | Claim matches implementation (confirming evidence cited).        |
| **DRIFT**         | Directionally right but stale/incomplete.                        |
| **VIOLATION**     | Code (or filesystem) contradicts the claim.                      |
| **CONTRADICTION** | Two documents — or a doc and its own diagram — assert conflicts. |
| **STALE**         | References something that no longer / does not yet exist.        |

Findings are identified `AF-NN`, with severity:

- **P0** — rule violation or authority-doc contradiction that actively misleads about boundaries/contracts. Must fix.
- **P1** — real drift: phantom packages, broken links, undocumented contracts, broken diagrams.
- **P2** — cosmetic / minor naming / incompleteness.

## 2. Mechanical Conformance Baseline (TC-03)

| Check                                                 | Result                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm harness:scan`                                   | **23/23 pass, exit 0** (full output: `harness-scan-baseline.txt`) |
| `node scripts/harness/check-dependency-direction.mjs` | **"No dependency direction violations found."**                   |

Reconciliation of scan output:

- `test-plans` initially failed because the GATE-IMPLEMENT-created `.agents/tasks/INFRA-002.md` lacked
  a `## Test Plan` section. Recorded as **AF-24** (process gap in `backlog-gate-guard`'s task template)
  and fixed in this task file so the baseline is clean. Re-run → 23/23.
- `file-size` scan reports 33 files >300 lines but **passes** (warning mode, not a failure). Recorded
  as **AF-25** (informational — pre-existing tech-debt list, out of scope for a doc audit).

## 3. Dependency Graph Ground Truth (TC-02)

Actual `@robota-sdk/agent-* → @robota-sdk/agent-*` edges, extracted mechanically from each
`package.json` (`dependencies` + `peerDependencies`):

```
agent-cli              → [agent-command, agent-core, agent-framework, agent-provider, agent-subagent-runner, agent-transport]
agent-command          → [agent-core, agent-framework]
agent-core             → []                       (zero-deps foundation — CONFIRMED)
agent-executor         → [agent-core]
agent-framework        → [agent-core, agent-executor, agent-interface-transport, agent-session, agent-tools]
agent-interface-transport → []                    (types-only — CONFIRMED)
agent-interface-tui    → []                        (types-only — CONFIRMED)
agent-playground       → [agent-core, agent-provider, agent-remote-client, agent-tools]
agent-plugin           → [agent-core]
agent-provider         → [agent-core]
agent-remote-client    → [agent-core]
agent-session          → [agent-core]
agent-subagent-runner  → [agent-core, agent-executor, agent-framework, agent-provider]
agent-tool-mcp         → [agent-core]
agent-tools            → [agent-core]
agent-transport        → [agent-core, agent-framework, agent-interface-transport, agent-interface-tui]
agent-web-ui           → [agent-transport]
```

**Result: NO dependency-direction violations.** Every edge respects the documented one-way direction;
`agent-core` and both `agent-interface-*` packages have zero `@robota-sdk/*` production deps. The
composition-root exemption holds: `agent-cli` references `agent-executor` only in `devDependencies`, so
it is correctly absent from the production edge set above.

> Note: this confirms the _mechanically enforced_ direction is clean. The drift below is in the
> _prose/diagram_ layer — documents describing this graph inaccurately — not in the graph itself.

## 4. Per-Document Verdict Summary (TC-01)

### Authority tier

| Document                            | Overall verdict       | Findings            |
| ----------------------------------- | --------------------- | ------------------- |
| `ARCHITECTURE.md`                   | CONTRADICTION + STALE | AF-02, AF-05        |
| `.agents/project-structure.md`      | HOLDS (with DRIFT)    | AF-14, AF-15, AF-16 |
| `.agents/specs/ARCHITECTURE-MAP.md` | DRIFT (router)        | AF-04 (link), AF-17 |

### Architecture-map subdocuments

| Document (`.agents/specs/architecture-map/`) | Overall verdict           | Findings            |
| -------------------------------------------- | ------------------------- | ------------------- |
| `repository-overview.md`                     | VIOLATION + DRIFT         | AF-04, AF-22        |
| `dependency-direction.md`                    | CONTRADICTION             | AF-04, AF-11        |
| `capability-placement.md`                    | VIOLATION + DRIFT         | AF-04, AF-15        |
| `agent-system.md`                            | CONTRADICTION + STALE     | AF-07, AF-11        |
| `agent-team.md`                              | **MISSING (broken link)** | AF-04               |
| `transport-architecture.md`                  | HOLDS (minor DRIFT)       | AF-09               |
| `agent-cli-composition.md`                   | HOLDS                     | —                   |
| `apps-and-deployment.md`                     | STALE + DRIFT             | AF-10, AF-18, AF-19 |
| `cross-cutting-contracts.md`                 | VIOLATION + DRIFT         | AF-08, AF-09, AF-12 |
| `architecture-lessons.md`                    | HOLDS                     | —                   |

### Package SPEC.md (17/17 present, 17/17 English)

| Package                     | Overall verdict       | Findings     |
| --------------------------- | --------------------- | ------------ |
| `agent-core`                | **VIOLATION** + STALE | AF-01, AF-06 |
| `agent-cli`                 | **CONTRADICTION**     | AF-03, AF-06 |
| `agent-executor`            | STALE                 | AF-06        |
| `agent-session`             | STALE                 | AF-06        |
| `agent-tool-mcp`            | DRIFT                 | AF-06        |
| `agent-tools`               | DRIFT                 | AF-06        |
| `agent-remote-client`       | STALE                 | AF-13        |
| `agent-command`             | DRIFT                 | AF-23        |
| `agent-framework`           | HOLDS (minor DRIFT)   | AF-21        |
| `agent-web-ui`              | HOLDS (title typo)    | AF-20        |
| `agent-interface-transport` | HOLDS                 | —            |
| `agent-interface-tui`       | HOLDS                 | —            |
| `agent-playground`          | HOLDS                 | —            |
| `agent-plugin`              | HOLDS                 | —            |
| `agent-provider`            | HOLDS                 | —            |
| `agent-subagent-runner`     | HOLDS                 | —            |
| `agent-transport`           | HOLDS                 | —            |

## 5. Findings (TC-04)

### P0

| ID        | Class         | Document / Location                                          | Evidence                                                                                                             | Finding                                                                                                                                                                                                                                                               |
| --------- | ------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AF-01** | VIOLATION     | `packages/agent-core/docs/SPEC.md` §842-845, §49-53          | `agent-core` @robota deps = `[]`                                                                                     | Zero-dep foundation SPEC names specific consumers (`agent-session`, `agent-tools`, `agent-team`, `agent-plugin-*`) in "Consumed By" + Layer diagram. Violates SSOT-no-external-refs rule (foundation pkgs must use role-based descriptions).                          |
| **AF-02** | CONTRADICTION | `ARCHITECTURE.md:38` vs `.agents/project-structure.md:31-39` | `ls packages/auth packages/credits` → absent                                                                         | ARCHITECTURE.md lists `auth`/`credits` in the live SDK-packages box (no "planned" marker); project-structure.md explicitly marks both "Planned (Not Yet Created)". Two authority-tier docs disagree on whether the packages exist.                                    |
| **AF-03** | CONTRADICTION | `packages/agent-cli/docs/SPEC.md:296`, §49-52                | actual deps = `[agent-command, agent-core, agent-framework, agent-provider, agent-subagent-runner, agent-transport]` | SPEC documents dep chain `agent-cli → agent-sdk → agent-sessions → agent-core` + `agent-provider-*`, naming 3 non-existent packages and omitting the 3 real deps (`agent-command`, `agent-subagent-runner`, `agent-transport`). Most misleading consumer-facing SPEC. |

### P1

| ID        | Class           | Document / Location                                                                                                     | Evidence                                                                                                                                        | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------- | --------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AF-04** | VIOLATION/STALE | `repository-overview.md:16`, `dependency-direction.md:14,62`, `capability-placement.md:37`, `ARCHITECTURE-MAP.md:17,35` | no `agent-team` pkg; no `agent-team.md`                                                                                                         | Phantom `agent-team` package referenced across 3 subdocs + router; the linked `agent-team.md` doc does not exist. Coordinated stale abstraction.                                                                                                                                                                                                                                                                                                                                                                            |
| **AF-05** | STALE           | `ARCHITECTURE.md:38-45`                                                                                                 | actual 17-pkg list                                                                                                                              | System Overview package box uses renamed/non-existent names (`agent-sessions`, `agent-runtime`, `agent-sdk`, `agent-team`, `agent-event-service`, `*-*` split pkgs) and omits real packages (`agent-executor`, `agent-subagent-runner`, `agent-interface-*`, `agent-tools`, `agent-web-ui`).                                                                                                                                                                                                                                |
| **AF-06** | STALE           | `agent-cli`, `agent-executor`, `agent-session`, `agent-tool-mcp`, `agent-tools` SPECs (~30 occurrences)                 | pkg names                                                                                                                                       | Systemic stale `agent-sdk` / `agent-sessions` naming; `agent-session` self-named `agent-sessions`. A rename (`agent-sessions`→`agent-session`) and `agent-sdk`→`agent-framework` consolidation were never propagated. Paths often correct, prose names wrong.                                                                                                                                                                                                                                                               |
| **AF-07** | CONTRADICTION   | `agent-system.md:126-138`                                                                                               | `ws-handler.ts:51,26-31`, `useWsSession.ts:43`, `agent-web-ui` pkg                                                                              | "[Planned — not yet implemented]" WebSocket Sidecar banner is stale: `createWsHandler({session,send})` and `useWsSession(url)` exist with the exact documented signatures. Only `startWebSidecarServer()` + CLI `--web` flags remain unimplemented.                                                                                                                                                                                                                                                                         |
| **AF-08** | VIOLATION       | `cross-cutting-contracts.md:58-59`                                                                                      | `packages/auth`, `packages/credits` absent                                                                                                      | Names `packages/auth/docs/SPEC.md` and `packages/credits/docs/SPEC.md` as contract owners; both packages do not exist (dead links to phantom owners).                                                                                                                                                                                                                                                                                                                                                                       |
| **AF-09** | DRIFT           | `background-task-layer.md`, `command-inventory.md`, all `.agents/specs/`                                                | `host-context.ts:152,161`, `packages/agent-command/src/schedule/`, `line-wake-matcher.ts`                                                       | FLOW-001~006 background/wake contracts entirely undocumented: `background-task-layer.md` has no wake/cron/schedule content, `command-inventory.md` lists no `/schedule` or `/monitor`, and `spawnScheduledWake`/`spawnMonitorWake` host-context bridges appear in no spec.                                                                                                                                                                                                                                                  |
| **AF-10** | STALE           | `apps-and-deployment.md` (docs-pipeline mermaid)                                                                        | `apps/docs/scripts/` absent                                                                                                                     | Cites dead script paths `apps/docs/scripts/copy-docs.js` + `copy-public.js`; the directory and scripts do not exist. (Cloudflare/`docs:deploy` parts are correct.)                                                                                                                                                                                                                                                                                                                                                          |
| **AF-11** | CONTRADICTION   | `dependency-direction.md:22,26,34`, `agent-system.md:48-49`                                                             | mermaid node decls                                                                                                                              | Broken mermaid diagrams with undeclared nodes (`Playground`, `TypeContracts`, `IfaceTransport`, `IfaceTui`) used as edge endpoints; `IfaceTransport/IfaceTui → Core` edges also wrongly imply a dep that does not exist (those packages are zero-dep).                                                                                                                                                                                                                                                                      |
| **AF-12** | STALE           | `command-inventory.md`                                                                                                  | only `@robota-sdk/agent-command` exists                                                                                                         | Lists non-existent per-command split packages (`@robota-sdk/agent-command-agent`, `-background`, etc.); only the monolithic `@robota-sdk/agent-command` exists. (Missing `/schedule`,`/monitor` entries overlap AF-09.)                                                                                                                                                                                                                                                                                                     |
| **AF-13** | STALE           | `packages/agent-remote-client/docs/SPEC.md:9`                                                                           | `agent-transport/src/{http,ws}`                                                                                                                 | Claims server code extracted to `agent-transport-http` / `agent-transport-ws` packages; it lives in subpaths of the single `agent-transport` package.                                                                                                                                                                                                                                                                                                                                                                       |
| **AF-14** | DRIFT           | `.agents/project-structure.md:77`                                                                                       | `agent-transport/src/**` imports from `@robota-sdk/agent-framework` (~76 files: `transport-registry.ts:8-9,14`, `tui/tui-transport.ts:4`, etc.) | Interface Package Rule says implementation packages take interface types from `agent-interface-*` "not on `agent-framework`". `agent-transport` imports interface types (`IInteractiveSession`, `CommandRegistry`, `IToolState`, `ICommandPluginAdapter`) + runtime helpers (`getUserSettingsPath`, `readSettings`) directly from `agent-framework`. The `transport→framework` edge is _allowed_ (dep check passes), so this is doc-aspiration drift, not a hard violation — but the rule clause is stale relative to code. |

### P2

| ID        | Class               | Document / Location                       | Finding                                                                                                                                                                                                                                   |
| --------- | ------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AF-15** | DRIFT               | `capability-placement.md:50-52`           | `Assembly→Adapters`/`Assembly→Orchestration` edges are aspirational layer rules, not actual package edges (`agent-framework` deps only `agent-tools` among Adapters; not provider/plugin/remote-client). Needs a "policy, not edge" note. |
| **AF-16** | DRIFT               | `.agents/project-structure.md:78`         | "framework depends on `agent-interface-*` packages" (plural) — only `agent-interface-transport` is wired, not `agent-interface-tui`.                                                                                                      |
| **AF-17** | DRIFT               | `.agents/specs/ARCHITECTURE-MAP.md:3`     | Stale "source-verified 2026-05-07" date (~5 weeks old).                                                                                                                                                                                   |
| **AF-18** | DRIFT               | `apps-and-deployment.md`                  | Omits `apps/action`, `apps/starter-nextjs`, `apps/www` from topology/ownership tables (7 apps exist; 4 documented).                                                                                                                       |
| **AF-19** | DRIFT/CONTRADICTION | `apps-and-deployment.md`                  | Says `apps/agent-web` deploys to Vercel, but the app ships `firebase.json` + firestore rules/indexes alongside `vercel.json` — deploy platform ambiguous.                                                                                 |
| **AF-20** | DRIFT               | `packages/agent-web-ui/docs/SPEC.md:1`    | Title `# SPEC.md — @robota-sdk/agent-web` vs actual `@robota-sdk/agent-web-ui`.                                                                                                                                                           |
| **AF-21** | DRIFT               | `packages/agent-framework/docs/SPEC.md:4` | Scope omits `agent-interface-transport` (a real dep).                                                                                                                                                                                     |
| **AF-22** | DRIFT               | `repository-overview.md:15`               | Lists `agent-web` as a package (it is `apps/agent-web` + the `agent-web-ui` package); omits `agent-web-ui`, `agent-interface-transport`, `agent-interface-tui` from the family table.                                                     |
| **AF-23** | DRIFT               | `packages/agent-command/docs/SPEC.md:11`  | "transport layer owned by `agent-transport-*`" — singular `agent-transport`.                                                                                                                                                              |

### Process / informational

| ID        | Class           | Finding                                                                                                                                                                                                                                  |
| --------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AF-24** | DRIFT (process) | `backlog-gate-guard`'s GATE-IMPLEMENT task-file template omits a `## Test Plan` section, which the `test-plans` harness scan requires for development docs — caused the baseline scan to fail until fixed. Worth folding into INFRA-003. |
| **AF-25** | INFO            | `file-size` scan lists 33 files >300 lines (warning mode, non-failing). Pre-existing tech-debt; out of scope for this doc audit.                                                                                                         |

## 6. Counts by Severity (TC-04)

| Severity           | Count  | IDs                 |
| ------------------ | ------ | ------------------- |
| **P0**             | 3      | AF-01, AF-02, AF-03 |
| **P1**             | 11     | AF-04 … AF-14       |
| **P2**             | 9      | AF-15 … AF-23       |
| Process/Info       | 2      | AF-24, AF-25        |
| **Total findings** | **25** |                     |

## 7. Headline Conclusions

1. **The dependency graph itself is clean.** Mechanical enforcement (`check-dependency-direction.mjs`,
   `harness:scan`) is green; `agent-core` and `agent-interface-*` are genuinely zero-dep. The
   architecture's _enforced_ invariants hold.
2. **The drift is entirely in prose + diagrams.** A historical rename (`agent-sessions`→`agent-session`,
   `agent-sdk`→`agent-framework`) and a never-created abstraction (`agent-team`) propagated stale names
   through ARCHITECTURE.md, multiple architecture-map subdocs, and ~6 package SPECs.
3. **The newest feature work is undocumented.** FLOW-001~006 (wake/schedule/monitor, host-context
   bridges) has zero coverage in the cross-cutting contract index — the audit's clearest "docs lag code".
4. **Two phantom packages (`auth`, `credits`) are described inconsistently** — planned in one authority
   doc, live in another, and named as contract owners in a third.
5. **Mechanical enforcement caught the graph but not the prose** — motivating INFRA-003 (a conformance
   skill system + gate that re-runs this audit and flags prose/diagram drift, not just the dep graph).

See `improvement-proposal.md` for prioritized remediation and follow-up backlog mapping.
