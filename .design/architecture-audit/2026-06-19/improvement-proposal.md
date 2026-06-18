# Architecture Conformance — Improvement Proposal (2026-06-19)

Maps the 26 findings in `conformance-audit-report.md` to remediation backlogs and mechanical
guards. This document proposes; it fixes nothing (spec-before-code — fixes ship as backlogs).

## Remediation Backlogs (proposed)

### DOCAUDIT-001 — Reconcile docs with the transport-package split (P0)

**Covers:** AF-01, AF-02, AF-03, AF-04, AF-05, AF-06, AF-07, AF-08, AF-10, AF-11, AF-12, AF-13, AF-18
(≈half of all findings; one root cause).

**Problem:** Docs describe a single `agent-transport` package with `tui/ws/http/mcp` subpaths; the
code has **five separate packages** (`agent-transport` + `agent-transport-{tui,ws,http,mcp}`), with
`agent-transport` retaining only `./headless` + `./testing`. One doc states the migration in reverse.

**Fix scope (doc-only, no code change):**

- `transport-architecture.md` — rewrite around 5 packages; remove the "single package, 5 subpaths"
  thesis; fix `ITuiCliAdapter`/handler paths; drop the false `agent-command → agent-interface-tui`
  consumer claim (AF-08).
- `repository-overview.md` — add the four `agent-transport-*` packages + `agent-session-analytics`
  to the inventory; stop modeling transport as one package (AF-03).
- `agent-system.md`, `dependency-direction.md`, `capability-placement.md`,
  `agent-cli-composition.md` — fix transport-subpath nodes, the stale `ws-handler.ts` /
  `tui/hooks/*` paths, the missing `agent-command → interface-transport` edge, the unbacked
  `remote-client → Adapters` edge (AF-04/05/06/07).
- `agent-cli/class-interface-inventory.md` — fix the reversed header map; relocate all 10 TUI rows
  to `agent-transport-tui` (AF-02).
- `agent-cli/composition-tree.md` + `layering-audit.md` — `createDefaultTransportRegistry` is a
  **local helper in `cli.ts:62`**, not an `agent-transport` export; fix the "no behavior helper /
  316 lines" claim (329); correct the command-module list (AF-10/11).
- `agent-cli/target-architecture.md` — add `CLI → agent-executor`; stop modeling transport as one
  node (AF-18).
- `agent-cli/docs/SPEC.md:710` + `agent-interface-transport/docs/SPEC.md` —
  `TuiInteractionChannel` and `TransportRegistry` ownership corrections (AF-12/13).

### DOCAUDIT-002 — Remove phantom / stale symbol references (P1)

**Covers:** AF-09, AF-16, AF-17.

- AF-09: delete all references to `createModelCommandModule` / `agent-command/src/model/` across the
  three agent-cli docs; document the real module set (mode/preset/schedule/settings).
- AF-16: either export `classifyFetchError` from `agent-tools` `src/index.ts` **or** remove it from
  the SPEC Public API Surface (decide owner intent first).
- AF-17: `agent-playground` SPEC — drop `IPlaygroundBootState`, `usePlaygroundBoot`,
  `PlaygroundAgentSession`, `usePlaygroundData`; fix `PLAYGROUND_STATISTICS_EVENTS` (not exported).

### DOCAUDIT-003 — Correct two contract inaccuracies (P1)

**Covers:** AF-14, AF-15.

- AF-14: `agent-session` SPEC — add `'allow-project'` to `TPermissionResult`; re-attribute
  `ITerminalOutput`/`ISpinner` as re-exports owned by `agent-core` (not `agent-session`); fix the
  Type-Ownership File columns (`permission-types.ts`/`session-types.ts`).
- AF-15: `agent-tool-mcp` SPEC — remove the "published to npm" claim (package is `private: true`),
  or flip `private` if publishing is actually intended (product decision — confirm).

### DOCAUDIT-004 — SPEC cosmetic cleanup (P2)

**Covers:** AF-19..AF-26. Batch the path/casing/undocumented-export fixes (agent-core hook paths,
agent-provider browser-exports note, RelayMcpTool `implements`, agent-web-ui `'use client'`,
agent-tools dep count + consumer path, agent-session undocumented exports, agent-remote-client
"empty stub" wording). Low-risk, single PR.

## Mechanical Guard Recommendations

Per AGENTS.md "prefer a mechanical check over more prose," convert the recurring failure classes
into harness scans so this drift cannot silently return:

- **G1 — cited-path existence (would catch AF-02/04/07/19 + most STALE).** A scan that extracts
  `packages/**/src/...` paths cited in architecture-map docs and SPEC.md and fails on any path that
  does not resolve. Highest ROI — the dominant defect class is "doc cites a moved/removed file."
- **G2 — transport/package-set parity (AF-01/03).** Assert the set of transport packages described in
  `transport-architecture.md` + `repository-overview.md` equals actual `packages/agent-transport*`
  dirs. Extends the existing `check-architecture-conformance` mechanical core.
- **G3 — SPEC public-surface parity (AF-16/17).** Assert every symbol in a SPEC "Public API Surface"
  is actually exported from the package entry (`src/index.ts`). Complements existing
  `check-orphan-exports` / `check-sdk-public-surface`.
- **G4 — published-vs-private (AF-15).** Fail if a SPEC says "published to npm" while
  `package.json` has `private: true`.

G1 and G3 alone would have mechanically caught ~15 of the 26 findings.

## Sequencing

1. **DOCAUDIT-001** first (P0, largest surface, one coherent rewrite).
2. **DOCAUDIT-002 / 003** (P1 phantom symbols + contract fixes) — can run in parallel.
3. **G1 + G3 guards** — land alongside or right after DOCAUDIT-001 so the corrected docs stay
   corrected; G2/G4 as fast-follows.
4. **DOCAUDIT-004** (P2) — opportunistic single PR.

All remediation is **doc-only** except the AF-16 export decision and the AF-15 `private` decision
(two small product/intent confirmations). No code dependency or boundary change is required —
the mechanical baseline is already green.

## Implementation Status (2026-06-19)

| Guard   | Scan                                                                 | Status      | Notes                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------- | -------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1      | `check-architecture-map-paths.mjs` (`harness:scan:arch-map-paths`)   | **Shipped** | Extends `check-spec-paths.mjs` (SPEC.md only) to `.agents/specs/architecture-map/**`. Exempts negation/removal lines and the historical `layering-audit.md` / `architecture-lessons.md` logs. Caught one residual stale ref (`agent-transport-tui/.../useInteractiveSession.ts` → `useTuiChannel.ts`).                                                                                                     |
| G2      | —                                                                    | **Skipped** | Largely subsumed by G1 (cited-path existence) plus the existing `check-architecture-conformance` package-set core. A dedicated transport-set parity scan would duplicate both for marginal gain; revisit only if transport-set drift recurs.                                                                                                                                                               |
| G3-lite | `check-spec-public-surface.mjs` (`harness:scan:spec-public-surface`) | **Shipped** | Conservative variant: flags any identifier in a SPEC "Public API" table that appears **nowhere** in the package `src/` (phantom export). Narrower than the proposed "exported from `src/index.ts`" assertion to keep false positives near zero — re-export-vs-definition nuances would otherwise produce noise; `check-orphan-exports` / `check-sdk-public-surface` already cover the entry-point surface. |
| G4      | `check-spec-publish-claims.mjs` (`harness:scan:spec-publish-claims`) | **Shipped** | Fails when a SPEC asserts npm publication while `package.json` has `private: true`. Caught `agent-web-ui` (line 14, fixed to drop the false "published npm package" claim).                                                                                                                                                                                                                                |

All three shipped guards are wired into `run-all-scans.mjs` (now **29 scans**) and exposed as
per-scan `harness:scan:*` npm scripts. Full `pnpm harness:scan` is green.
