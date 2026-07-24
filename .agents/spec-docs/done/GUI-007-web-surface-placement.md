---
status: done
type: INFRA
capability: true
user_execution: agent-run
user_execution_scenario: .agents/evals/scenarios/gui-007-cli-served-monitor-agent-run.md
tags:
  [architecture, placement, web, gui, surface-taxonomy, agent-web, agent-web-monitor, cli, sec-001]
---

# GUI-007: web-surface placement cleanup — dissolve `apps/agent-web-monitor`

## Problem

The web-surface layout has drifted from the `packages/` (library) vs `apps/` (deployable app) convention and
from the GUI-005 surface taxonomy. Three concrete defects (an independent `architecture-auditor` pass +
owner review, 2026-07-19):

1. **`apps/agent-web-monitor` is not really an "app" — it is a CLI-owned asset conflated with a hosted page.**
   Its `index.html`/`main.tsx` is the **CLI-served** session monitor SPA (bundled into the CLI at build via
   `packages/agent-cli/scripts/copy-web-assets.mjs` → `agent-cli/dist/web`); its `remote.html`/`remote.tsx` is
   a **hosted, deployed** Stage-D remote page (the CLI message tells the user to point settings at "your
   hosted Stage-D page"). Two different lifecycles (a CLI build-asset vs a deployed page) live in one `apps/`
   dir, and the reusable UI (`SessionMonitor`, `RemoteClient`) is already a library
   (`packages/agent-transport-gui`, `packages/agent-transport-webrtc-web` `./client`). What remains in
   `apps/agent-web-monitor` is a thin build host mis-placed as a top-level product app.
2. **Duplicate monitor.** `apps/agent-web`'s `/monitor` route renders the same `SessionMonitor` over the same
   `ws://localhost:7070` as `agent-web-monitor` — one capability owned by two surfaces (the doc,
   `content/guide/architecture.md`, assigns the browser monitor to `agent-web-monitor` only).
3. **Naming confusion.** `agent-web` (Playground host) and `agent-web-monitor` (session monitor shell) both
   grabbed "web" names; neither reveals its identity, and `agent-web-monitor` reads like a variant of the
   Playground app.

## Prior Art Research

Comparable CLI-first tools that also ship a browser UI treat the CLI-served web UI as a **bundled asset of the
tool**, not a standalone deployable "app", while keeping any genuinely-hosted page separate:

- **VS Code** serves its web UI (`code serve-web` / `code-server`) as a UI bundled INTO the CLI/server binary;
  the reusable UI is library code, not a separate deployed app. Docs:
  <https://code.visualstudio.com/docs/remote/tunnels>
- **Jupyter** bundles the Notebook/Lab front-end as an asset the server serves at runtime — it is shipped
  inside the server package, not maintained as an independent deployed application. Docs:
  <https://jupyter-server.readthedocs.io/en/latest/operators/security.html>
- **Docker** ships the `docker` CLI + engine as the primary artifact; Docker Desktop's UI is a separate bundle,
  and the CLI does not depend on a UI "app" to function headless. Docs:
  <https://docs.docker.com/desktop/>

Common pattern: **reusable UI = library; the CLI-served web UI = an asset the CLI bundles/serves (not a
top-level app); a genuinely-hosted page is a deployed web surface.** This maps directly onto the fix below.
(The distribution-topology dimension — one engine, layered CLI/GUI distribution — is a SEPARATE follow-up
spec; GUI-007 is scoped to surface PLACEMENT only.)

## Architecture Review

### Affected Scope

- `apps/agent-web-monitor` (dissolved), `packages/agent-cli` (`copy-web-assets.mjs`, serve path), `apps/agent-web`
  (`/monitor` removed, `/remote` route added), `content/guide/architecture.md` + `.agents/project-structure.md`
  - architecture map, `CODEOWNERS`, deploy/CI config, and the SEC-001 spec's client target.

### Alternatives Considered

- **Keep `apps/agent-web-monitor` as an app** — rejected: it is a CLI build-asset + a hosted page, not a
  deployable product; conflates two lifecycles; duplicates the monitor role.
- **Merge `agent-web` + `agent-web-monitor` into one app** — rejected: different build systems (Next.js/Vercel
  vs Vite/CLI-served) and serve topologies (public host vs CLI-served local); merging fights the topology.
- **Put the monitor SPA inside `packages/agent-cli/web/`** — viable, but mixes a Vite sub-build into the CLI's
  Bun/tsdown build; rejected in favor of an isolated package (below), which keeps build systems clean and
  preserves the existing build-time `copy-web-assets` pattern.

### Decision (OWNER-APPROVED direction, 2026-07-19)

Dissolve `apps/agent-web-monitor`; place each piece by its true identity:

1. **Monitor SPA → `packages/agent-cli-web`** (a CLI-owned asset package, Vite build isolated; the CLI copies
   its `dist` at build via `copy-web-assets.mjs`, exactly as today — only the source path changes). It is NOT a
   top-level `apps/` product; it is the CLI's built-in web UI. (Mirrors the `packages/agent-playground`
   product-shell precedent — a private UI package in `packages/`.)
2. **The CLI actually SERVES its own monitor (OWNER-APPROVED, 2026-07-19).** Today `dist/web` is copied but
   NOTHING serves it at runtime — the only working browser monitor is the DEPLOYED `apps/agent-web` `/monitor`
   page (a public page reaching into the user's `localhost:7070`), which is exactly the SEC-001 "any web page
   can reach loopback" threat. GUI-007 wires a **static HTTP host for `dist/web` in the CLI `--serve`/runtime
   path (SEPARATE from the WS transport — the transport must not serve a UI bundle)**, plus a `robota --serve
--open` convenience. This realizes "the CLI owns AND serves its monitor" and makes the monitor a
   **localhost-origin** surface — the secure replacement for the public-page→localhost topology (SEC-001 win).
   The static serve MUST land before/with removing the deployed `/monitor` (item 4), so a working monitor path
   always exists.
3. **Hosted Stage-D remote page → a route of `apps/agent-web`** (`/remote`, rendering `RemoteClient` from
   `@robota-sdk/agent-transport-webrtc-web/client`, ssr:false — same pattern as its Playground route). Requires
   ADDING `@robota-sdk/agent-transport-webrtc-web` to `apps/agent-web/package.json` (it is not a dep today).
   All genuinely-DEPLOYED web pages then live in the one deployed web app.
4. **Remove `apps/agent-web`'s `/monitor` route** (page + `MonitorClient` + `NEXT_PUBLIC_CLI_WS_URL`) — the
   public-page→localhost monitor. Safe once item 2 (CLI-served localhost monitor) is wired; it also removes a
   SEC-001 attack surface. `apps/agent-web` = deployed web app (Playground host + hosted remote page).
5. **Transport-family names unchanged** — `agent-transport-gui` / `agent-transport-webrtc-web` stay (they are
   the transport area; the GUI core keeps its `agent-transport-*` name per owner constraint).
6. **`packages/agent-cli-web` is a sanctioned product-shell package** — amend the `Library Neutrality Rule`
   text in `.agents/project-structure.md` to name it as a THIRD product-shell member (beside `agent-cli`,
   `agent-playground`); the package-tree entry alone is insufficient for the neutrality gate.
7. **SEC-001 client retarget** — in `.agents/backlog/SEC-001-default-loopback-ws-auth.md` (the spec's actual
   path): the CLI-served monitor client is now `packages/agent-cli-web` (served from localhost by item 2) —
   REMOVE the `apps/agent-web` monitor-client reference (route deleted) and ADD `agent-cli-web`; the plain-TUI
   client reference stays.

Resulting `apps/`: `agent-web` (deployed web: Playground + remote) and `agent-app` (desktop) — both genuinely
deployable products. The naming confusion dissolves because `agent-web-monitor` no longer exists.

## Solution

Move + split + rewire (pure relocation; no behavior change to the monitor or remote UI, which are unchanged
library components):

- **P1 — CLI-owned monitor, actually served:** create `packages/agent-cli-web` from `apps/agent-web-monitor`
  (monitor SPA only: `index.html` + `main.tsx` + build); repoint `copy-web-assets.mjs` src; delete
  `apps/agent-web-monitor`. **Wire a static HTTP host for `dist/web` in the CLI `--serve`/runtime path**
  (separate from the WS transport) + `robota --serve --open`, so the monitor is genuinely CLI-served from
  localhost. Amend the `Library Neutrality Rule` to name `agent-cli-web` as a product-shell member.
- **P2 — deployed web pages consolidated:** add `apps/agent-web` `/remote` route hosting `RemoteClient` (from
  the old `remote.html`) + add the `@robota-sdk/agent-transport-webrtc-web` dependency; remove `apps/agent-web`
  `/monitor` route + `NEXT_PUBLIC_CLI_WS_URL` (safe now that P1's CLI-served monitor exists).
- **P3 — docs + SEC-001:** docs/map/structure/CODEOWNERS/deploy refresh; retarget the SEC-001 spec client refs
  (path `.agents/backlog/SEC-001-...`: remove the agent-web monitor client, add agent-cli-web, keep the TUI).

## Affected Files

- `apps/agent-web-monitor/**` (→ `packages/agent-cli-web/**`, minus remote)
- `packages/agent-cli/scripts/copy-web-assets.mjs`, `packages/agent-cli/package.json` (build dep/order),
  `packages/agent-cli/src/modes/serve-mode.ts` (+ static-serve wiring for `dist/web` + `--open`)
- `apps/agent-web/src/app/monitor/**` (removed), `apps/agent-web/src/app/remote/**` (added),
  `apps/agent-web/package.json` (**add** `@robota-sdk/agent-transport-webrtc-web`), `vercel.json`
- `.agents/project-structure.md` (**Library Neutrality Rule**: name `agent-cli-web` as a product-shell member),
  `content/guide/architecture.md`, `.agents/specs/architecture-map/*`, `CODEOWNERS`
- `.agents/backlog/SEC-001-default-loopback-ws-auth.md` (client retarget: −agent-web monitor client,
  +agent-cli-web, keep TUI)

## Completion Criteria

- TC-01 — `apps/agent-web-monitor` no longer exists; `packages/agent-cli-web` builds the monitor SPA,
  `copy-web-assets` copies it into `agent-cli/dist/web`, and the CLI `--serve` path STATICALLY SERVES it (the
  static host is wired — not merely copied). `robota --serve` exposes the monitor over localhost HTTP.
- TC-02 — `apps/agent-web` has NO `/monitor` route; its monitor duplication + `NEXT_PUBLIC_CLI_WS_URL` are gone.
- TC-03 — `apps/agent-web` `/remote` renders the Stage-D `RemoteClient` (the former `remote.html`), building
  under Next.js.
- TC-04 — dependency direction holds (agent-cli-web depends on the GUI core, never the reverse); no scan
  regressions (`check-dependency-direction`, `project-structure`, `arch-map-*`, `spec-public-surface`).
- TC-05 — docs/map/structure/CODEOWNERS reflect the new placement; no dangling `agent-web-monitor` reference.
- TC-06 (AGENT-RUN) — the agent drives the real CLI: `robota --serve` serves the monitor over localhost HTTP,
  and a headless browser loads it against a live session and renders the conversation (evidence under
  `.agents/evals/scenarios/`). This is now executable because P1 wires the static serve.
- TC-07 — the CLI-served monitor is a **localhost-origin** surface (served from the same loopback host), so the
  SEC-001 Origin allow-list accepts it while the removed public-page→localhost path is gone (security-alignment
  check).

## Test Plan

Build the new `packages/agent-cli-web` + the CLI (`copy-web-assets` round-trip); Next.js build of `apps/agent-web`
with the `/remote` route and no `/monitor`; harness scans (deps/structure/arch-map); the AGENT-RUN serve smoke.

## Tasks

- [x] P1 — `packages/agent-cli-web` + `copy-web-assets` repoint + CLI static-serve wiring (`--serve --open`) +
      Library-Neutrality-Rule amend DONE (P1a 423391668, P1b b9b7fcb72); delete `apps/agent-web-monitor` is P2
- [x] P2 — `apps/agent-web` `/remote` route (+webrtc-web dep) + remove `/monitor` + delete agent-web-monitor DONE
- [x] P3 — docs/map/structure + capability-placement + agent-cli-web SPEC/README + SEC-001 delivery via injection DONE
- [x] AGENT-RUN verification (TC-06/07) DONE — .agents/evals/scenarios/gui-007-cli-served-monitor-agent-run.md

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-19

- Prior Art Research: PRESENT + substantiated (CLI-served web UI as a bundled asset, not a standalone app —
  VS Code / Jupyter / Docker; 3 citations) → `scan-spec-research` green.
- Frontmatter (`status`/`type: INFRA`/`tags`): `check-spec-doc-frontmatter` green.
- Owner-approved DIRECTION (conversation, 2026-07-19): dissolve `apps/agent-web-monitor`; monitor → CLI-owned
  package; hosted remote → `apps/agent-web` route; transport-family names kept; scoped to placement (the
  distribution topology is a separate follow-up).
- Grounding: independent `architecture-auditor` REFACTOR verdict (agent-web `/monitor` duplication +
  topology-mismatch; agent-web-monitor conflated with the hosted remote page).

### [GATE-APPROVAL] — ✅ PASS | 2026-07-19

Independent `proposal-reviewer`: **REVISE → resolved**. The reviewer ENDORSED the three structural moves on
principle (placement PASS — `agent-cli-web` mirrors the `agent-playground` product-shell precedent; reuse at
the shared-core level; dependency-direction clean, the CLI→SPA edge is build-time copy only), and verified the
premises against code. REVISE was for one load-bearing false premise + wiring gaps, ALL now resolved:

1. **Serving reality (blocking, OWNER-DECIDED).** The reviewer proved the CLI does NOT serve `dist/web` at
   runtime today — the only working browser monitor is the DEPLOYED `apps/agent-web` `/monitor` (public
   page → localhost), which is the SEC-001 hole. **Owner chose option (a): the CLI serves its own monitor.**
   Spec re-scoped: P1 wires a static HTTP host for `dist/web` in the `--serve` path (separate from the WS
   transport) + `--open`; TC-01/TC-06 reworded to this executable reality; `/monitor` removal sequenced AFTER
   the CLI serve exists; added TC-07 (localhost-origin monitor = SEC-001 win).
2. **Missing dep** `@robota-sdk/agent-transport-webrtc-web` → added to `apps/agent-web/package.json` in P2 +
   Affected Files.
3. **Product-shell exemption** for `agent-cli-web` → P1 amends the `Library Neutrality Rule` text (third
   member), not just the package tree.
4. **SEC-001 refs** → corrected path (`.agents/backlog/…`), framed as remove-agent-web-monitor-client +
   add-agent-cli-web, TUI client reference kept.

Owner DIRECTION + the serving-reality decision (a) captured. Structural direction endorsed + revisions
applied → **approved**.

### [GATE-VERIFY] — ✅ PASS | 2026-07-20

- TC-01: `apps/agent-web-monitor` deleted; `packages/agent-cli-web` builds the monitor SPA; `copy-web-assets`
  copies it into `agent-cli/dist/web`; the CLI `--serve --open` STATICALLY SERVES it over localhost HTTP
  (AGENT-RUN verified — `Web monitor: http://127.0.0.1:<port>`).
- TC-02: `apps/agent-web` has no `/monitor` route (removed); `NEXT_PUBLIC_CLI_WS_URL` gone.
- TC-03: `apps/agent-web` `/remote` renders `RemoteClient` (ssr:false dynamic import, mirrors the Playground
  route); agent-web typecheck clean (full `next build` deferred to CI).
- TC-04: dependency-direction + project-structure + arch-map + capability-placement + spec-public-surface all
  green (agent-cli-web is a build-time file-copy of agent-cli, no package edge).
- TC-05: 0 dangling `agent-web-monitor` references repo-wide; docs/map/structure refreshed.
- TC-06/07 (AGENT-RUN): `robota --serve --open` serves the monitor with `<meta ws-url ...?token=<64-hex>>`
  injected (SEC-001); a localhost-origin surface. Evidence scenario saved.
- 62/62 run-all-scans; agent-cli 232 tests; serve-monitor-ui 5; ws-transport-auth 15.

**GATE-COMPLETE pending** the PR review (HARNESS-018) + merge-verify.

### [GATE-COMPLETE] — ✅ PASS | 2026-07-20

All TC-01..07 met (agent-web-monitor dissolved; agent-cli-web CLI-served monitor; agent-web /remote; 0 dangling refs; AGENT-RUN verified). Merged #1249. pr-review-reviewer 1 SHOULD (malformed-URL DoS) + CONSIDER (monitor Host guard) + 2 NIT all applied (`36f2cc6d6`); merge-verified on develop. Spec → `done/`.
