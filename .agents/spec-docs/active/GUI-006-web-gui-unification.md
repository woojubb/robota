---
status: in-progress
type: INFRA
tags: [gui, architecture, presentation, web, webrtc, refactor, cleanup]
---

# GUI-006: web GUI unification over agent-transport-gui + absorb/retire agent-web-ui (GUI Phase-2)

> Phase-2 of the GUI taxonomy established by GUI-005 (**presentation = TUI | GUI; GUI = app | web over a shared
> core `agent-transport-gui`**). GUI-005 made the **desktop** surface (`apps/agent-app`) a first-class GUI over
> the shared core and reduced `agent-web-ui` to the browser-remote surface, but left `agent-web-ui` standing as
> a distinct package. The owner directed that it be cleaned up: **"결국은 차후에 agent-web-ui 는 정리되어야겠다.
> 삭제하거나 다른거에 흡수되거나."** This spec places each of `agent-web-ui`'s remaining responsibilities into
> its correct taxonomy home and deletes the package — with **zero behavior change** to the CLI-served web pages
> or the Next.js playground monitor.

## Problem

After GUI-005, `packages/agent-web-ui` still bundles three distinct responsibilities that belong in different
layers of the taxonomy:

1. **`SessionMonitor`** (`src/components/SessionMonitor.tsx`) — a localhost-WS **web session shell**: pure
   presentation over the shared reducer (`useWsSession` + `ConversationView` + `AgentActivityPanel` from
   `agent-transport-gui`), with a header/status strip, a URL connect box, and a composer. It is the **web
   analog of `SessionSurface`** (the desktop shell that already lives in the core). It has no RTC/pairing
   dependency.
2. **Browser-remote (WebRTC) peer** (`src/client/rtc-*.ts`, `device-credential-store.ts`, `parse-*.ts`,
   `hooks/useRtcSession.ts`, `components/RemoteClient.tsx`) — the REMOTE-009..013 Stage-D browser peer: native
   `RTCPeerConnection` answerer, fail-closed `ResponderGate`, directional-HMAC pairing over the data channel,
   TOFU/E3 device credentials, E4 session-resume. This is the **browser mirror of the node-side host transport
   `packages/agent-transport-webrtc`** (which is node/`werift`). It depends on `agent-remote-pairing`.
3. **The Vite SPA build** (`spa/index.html`+`main.tsx` → `SessionMonitor`; `spa/remote.html`+`remote.tsx` →
   `RemoteClient`) — the actual browser pages. `agent-cli` **serves these**: `scripts/copy-web-assets.mjs`
   copies `agent-web-ui/dist/spa` → `agent-cli/dist/web` (a build-time asset copy; the CLI has **no code/dep
   import** of `agent-web-ui`). `apps/agent-web` (Next.js playground) additionally imports `SessionMonitor` as a
   library at its `/monitor` route.

Mixing a shared presentation shell, a security-critical transport peer, and a servable app bundle in one
"browser product" package is the exact GUI-005 anti-pattern one layer up. Each has a different correct owner.

## Architecture Review

### Placement Decision (the primary, owner-visible decision)

Per the New-Surface Architecture Placement rule, this is the decision to weigh first. GUI-006 introduces one
new **transport-family** package and one new **web app**, and reclassifies `SessionMonitor` into the shared
core. Each is placed by mirroring its closest existing structural analog:

| Responsibility (today in agent-web-ui)                          | New home                                             | Mirrors / product-family                              | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionMonitor` (localhost-WS web shell)                       | **`packages/agent-transport-gui`** (shared GUI core) | `SessionSurface` (desktop shell already in the core)  | Pure presentation over the reducer, no RTC dep — the web sibling of the desktop shell. Reuse at the shared-core level: both `apps/agent-web` and the CLI-served web app consume it from the core.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Browser-remote (WebRTC) peer + `RemoteClient` + `useRtcSession` | **NEW `packages/agent-transport-webrtc-web`**        | node host transport `packages/agent-transport-webrtc` | It is the **browser** side of the same WebRTC transport (native `RTCPeerConnection`, no `werift`/`ws`); a transport-family sibling, not a product. Deps: `agent-transport-gui` + `agent-remote-pairing` + `agent-transport-protocol` (NOT `agent-interface-transport` — no direct import; reached transitively). Asymmetry (named, not a strict mirror): unlike the headless node peer, this one also carries the `RemoteClient` page + `useRtcSession` hook — i.e. transport **+** presentation — consistent with the repo's loose `agent-transport-*` family (`-tui`/`-gui` are React presentation cores), and it keeps the reusable `RemoteClient` shell in a package with a thin app entry, exactly like `SessionSurface`/`SessionMonitor` in the core. |
| Vite SPA (`index.html` monitor + `remote.html` Stage-D)         | **NEW `apps/agent-web-monitor`** (Vite)              | `apps/agent-app` (desktop GUI app)                    | The CLI-served web pages ARE a deployable web GUI **app** — the "web" sibling of the desktop "app". Composes the core's `SessionMonitor` + the RTC package's `RemoteClient`. `agent-cli/copy-web-assets` re-points to this app's `dist`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| The package itself                                              | **deleted**                                          | —                                                     | Fully absorbed; nothing left that duplicates the core.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**Taxonomy after GUI-006:**

```
presentation
├── TUI  → agent-transport-tui (core) ← agent-cli (app)
└── GUI  → agent-transport-gui (core: reducer + SessionSurface + SessionMonitor)
      ├── app → apps/agent-app         (Electron desktop)
      └── web → apps/agent-web-monitor (Vite, CLI-served)  +  apps/agent-web (/monitor route)
                   └── remote capability → agent-transport-webrtc-web (browser transport)
                                             ↔ agent-transport-webrtc (node host transport)
```

### Affected Scope

- **NEW `packages/agent-transport-webrtc-web`** — the browser WebRTC transport peer (moved verbatim from
  `agent-web-ui/src/client/*` + `hooks/useRtcSession.ts` + `components/RemoteClient.tsx`, incl. the 45-test
  suite). Deps: `agent-transport-gui`, `agent-remote-pairing`, `agent-transport-protocol`; peer `react`. NOT
  `agent-interface-transport` (verified: zero direct imports in the moved src — reached transitively). Does NOT
  need `react-markdown`/`remark-gfm` (those live with `ConversationView` in the core).
- **NEW `apps/agent-web-monitor`** — a minimal Vite SPA (moved from `agent-web-ui/spa/*`): `index.html`+monitor
  entry (composes core `SessionMonitor`) and `remote.html`+remote entry (composes
  `agent-transport-webrtc-web`'s `RemoteClient`), plus `main.css` (owns the Tailwind entry + `@source` over the
  core, exactly like `apps/agent-app`). No package API.
- **`packages/agent-transport-gui`** — gains `SessionMonitor` (moved from agent-web-ui) as an exported web
  shell; SPEC/exports updated.
- **`packages/agent-cli`** — TWO build-time edits (the CLI has no code/package dep, but it BUILDS + serves the
  SPA): (a) `scripts/copy-web-assets.mjs` source path `agent-web-ui/dist/spa` → `apps/agent-web-monitor/dist`;
  (b) `package.json` `build` script step `pnpm --filter @robota-sdk/agent-web-ui build:spa` →
  `--filter @robota-sdk/agent-web-monitor build`. Plus the user-facing help string in
  `src/remote-control/remote-control-controller.ts:138` referencing `@robota-sdk/agent-web-ui` → the new
  Stage-D page's home. No other code change.
- **`apps/agent-web`** — `/monitor` route re-points the dynamic import from `@robota-sdk/agent-web-ui/client` to
  `@robota-sdk/agent-transport-gui/**client**` (the browser subpath; `SessionMonitor` must be exported from the
  core's single entry so it is reachable via `/client`); drop the `agent-web-ui` dep from `package.json`.
- **DELETE `packages/agent-web-ui`** — verified consumers are exactly: `agent-cli` (build-time SPA + help
  string), `apps/agent-web` (SessionMonitor), and the package's own `spa/` (moving to `apps/agent-web-monitor`).
  All re-pointed above; deletion is safe.
- **Docs/structure** — `.agents/project-structure.md` (inventory tree + the **Library Neutrality Rule
  product-shell clause** at ~line 78 that currently sanctions `packages/agent-web-ui` — must remove it), arch-map
  (the sidecar-mode table + web split), capability-placement allowlist (add the two new entries, remove
  `agent-web-ui`). CHANGELOG references left as historical.

### Alternatives Considered

- **B — fold the browser-remote into `agent-transport-gui` as a `./remote` subpath.** REJECTED: it would pull
  `agent-remote-pairing` into the core, breaking the core's contract-pure boundary (deps = interface-transport +
  transport-protocol only) and re-coupling every core consumer to the pairing crypto.
- **C — rename `agent-web-ui` → `agent-transport-webrtc-web`, keep the SPA html entries inside it, move only
  `SessionMonitor` into the core.** Lighter (no new app), but a **transport package owning an app's html shell +
  Tailwind entry** is the same layer-mixing smell one level down, and it leaves the CLI serving assets built by a
  "transport" package rather than a web app. Viable as a reduced-scope fallback if the owner prefers fewer new
  homes; the recommendation is A for a clean app/transport split.
- **D — rename-only (`agent-web-ui` → `agent-web-remote`), no structural move.** REJECTED: does not absorb per
  the owner's "정리 (deleted or absorbed)" directive; preserves the mixed-responsibility product.
- **App-count note:** A adds `apps/agent-web-monitor` as a distinct Vite app separate from the Next.js
  `apps/agent-web`. They are different deployments (a CLI-served static SPA vs an SSR playground); merging them
  is out of scope (and the CLI cannot serve a Next.js SSR app statically).

### Architecture Review Checklist

- [x] New-surface placement surfaced FIRST + independently validated — proposal-review 2026-07-12: **REVISE →
      placement ENDORSED**, 5 premise/scope corrections applied (see Evidence Log).
- [x] Mirror-analog identified for each new surface (SessionMonitor↔SessionSurface; webrtc-web↔webrtc [with the
      named transport+presentation asymmetry]; agent-web-monitor↔agent-app) — stated above.
- [x] Reuse at shared-core level, not skin-on-a-product — SessionMonitor into the core; the app composes core +
      transport, not a sibling product.
- [x] No dependency cycle; core stays contract-pure (no pairing dep leaks in) — confirmed by proposal-review.
- [x] No pass-through re-exports.
- [x] Zero behavior change to the CLI-served pages + the Next.js monitor route (pure relocation) — the CLI
      build-time SPA ref + help string + `apps/agent-web` `/client` subpath are in Affected Files.

## Decision

Adopt **Design A**: move `SessionMonitor` into `agent-transport-gui`; extract the browser-remote peer into a
new transport-family package `agent-transport-webrtc-web` (browser mirror of `agent-transport-webrtc`); move the
CLI-served SPA into a new `apps/agent-web-monitor` (web GUI app, sibling of `apps/agent-app`); re-point
`agent-cli`'s asset copy and `apps/agent-web`'s monitor import; delete `agent-web-ui`. The relocation is
behavior-preserving and verified by the migrated test suites + the CLI serve path + both web pages rendering.

Reduced-scope fallback (owner's call at GATE-APPROVAL): **Design C** if fewer new homes is preferred.

## Affected Files

- NEW `packages/agent-transport-webrtc-web/**` (package.json, tsdown/tsconfig, moved `src/**` + `__tests__`,
  docs/SPEC.md, README).
- NEW `apps/agent-web-monitor/**` (package.json, vite.config, `index.html`/`remote.html` + entries, `main.css`,
  docs).
- `packages/agent-transport-gui/src/components/SessionMonitor.tsx` (moved in) + `src/index.ts` + `docs/SPEC.md`.
- `packages/agent-cli/scripts/copy-web-assets.mjs` + `packages/agent-cli/package.json` (build script) +
  `packages/agent-cli/src/remote-control/remote-control-controller.ts` (help string).
- `apps/agent-web/src/app/monitor/MonitorClient.tsx` (`/client` subpath re-point) + `package.json` (drop dep).
- DELETE `packages/agent-web-ui/**`.
- `.agents/project-structure.md` (inventory tree + Library Neutrality product-shell clause),
  `.agents/specs/architecture-map/agent-system.md`, `scripts/harness/check-capability-placement.mjs`.

## Completion Criteria

- **TC-01** — `agent-transport-gui` exports `SessionMonitor`; builds + typechecks; deps unchanged
  (still contract/protocol only — SessionMonitor adds no new dep). Core unit + component coverage green.
- **TC-02** — NEW `agent-transport-webrtc-web` builds + typechecks; owns the RTC browser peer + `RemoteClient` +
  `useRtcSession`; the migrated 45-test suite passes; deps = agent-transport-gui + agent-remote-pairing +
  transport-protocol (NO interface-transport, no `werift`/`ws`, no `react-markdown`, no pass-through re-export).
- **TC-03** — NEW `apps/agent-web-monitor` builds (Vite + Tailwind); its `index.html`/`remote.html` render the
  monitor + Stage-D pages; agent-owned headless-browser smoke (Playwright) of at least the monitor page
  connecting + the remote page mounting.
- **TC-04** — `agent-cli` build copies the SPA from `apps/agent-web-monitor/dist`; the served monitor/remote
  routes are byte-equivalent in behavior (CLI web-serve path green).
- **TC-05** — `apps/agent-web` (`robota-web`) `/monitor` imports `SessionMonitor` from
  `@robota-sdk/agent-transport-gui/client` (browser subpath); typecheck + build green with no behavior change.
- **TC-06** — `packages/agent-web-ui` deleted; no dangling references (grep clean outside CHANGELOGs);
  dependency-direction + no cycle; core still contract-pure; `pnpm harness:scan` green (deps,
  capability-placement, spec-paths, spec-public-surface, doc-examples, conformance); `.agents/project-structure.md`
  - arch-map + capability-placement updated.

## Test Plan

- **TC-01** (command): `pnpm --filter @robota-sdk/agent-transport-gui build && typecheck && test`; `SessionMonitor`
  in the public-API table.
- **TC-02** (command): `pnpm --filter @robota-sdk/agent-transport-webrtc-web build && typecheck && test` (45
  tests migrated); deps assertion (no werift/ws).
- **TC-03** (headless browser, agent-owned): build `apps/agent-web-monitor`; Playwright loads `index.html`
  (monitor connects to a stub WS) + `remote.html` (RemoteClient mounts); screenshot both.
- **TC-04** (command/e2e): `pnpm --filter @robota-sdk/agent-cli build`; assert `dist/web/index.html` +
  `remote.html` present; the CLI remote-control/monitor serve path unchanged.
- **TC-05** (command): `pnpm --filter robota-web typecheck && build`.
- **TC-06** (harness/static): grep no `agent-web-ui` references (excl. CHANGELOG/historical spec-docs); `pnpm
harness:scan` all green; independent conformance audit.

## Tasks

Deferred to GATE-IMPLEMENT (task file `.agents/tasks/GUI-006.md` authored then). Preliminary shape: T1 scaffold
`agent-transport-webrtc-web` + move RTC files/tests; T2 move `SessionMonitor` into the core; T3 scaffold
`apps/agent-web-monitor` + move SPA entries + Tailwind entry; T4 re-point `agent-cli` copy + `apps/agent-web`
import; T5 delete `agent-web-ui` + structure/arch-map/placement updates; T6 affected typecheck/tests/harness +
agent-owned browser smoke; T7 feature→develop→main via merge-verifier; T8 GATE-COMPLETE.

## Evidence Log

### [proposal-review] — 🔧 REVISE (round 1) → revisions applied | 2026-07-12

Independent placement validation (proposal-reviewer), as required by the New-Surface Architecture Placement
rule. **Placement (Design A) ENDORSED** — the three-way split correctly mirrors its analogs
(SessionMonitor↔SessionSurface, webrtc-web↔webrtc, agent-web-monitor↔agent-app); reuse is at the shared-core
level; no cycle; the core stays contract-pure; Design C correctly rejected on layer-mixing (a deployable SPA +
Tailwind entry inside a transport package), not on diff size. Premises P1 (SessionMonitor pure presentation) and
P2 (RTC deps = pairing + protocol + native RTCPeerConnection, no werift/ws) verified TRUE.

Verdict **REVISE** on five factual/scope corrections — all applied to this spec:

1. **P3a corrected** — the "agent-cli: no code change" claim was overstated. The CLI BUILDS + serves the SPA:
   `agent-cli/package.json` `build` runs `pnpm --filter @robota-sdk/agent-web-ui build:spa` (must re-point), and
   `remote-control-controller.ts:138` has a user-facing help string naming `@robota-sdk/agent-web-ui`. Both
   added to Affected Scope + Affected Files (else TC-06 grep-clean fails).
2. **apps/agent-web re-point target** fixed to `@robota-sdk/agent-transport-gui/**client**` (browser subpath),
   with SessionMonitor exported from the core's single entry for `/client` reachability.
3. **`agent-transport-webrtc-web` deps** — dropped `agent-interface-transport` (verified zero direct imports;
   reached transitively).
4. **Library Neutrality Rule clause** (`.agents/project-structure.md` ~line 78) that currently sanctions
   `packages/agent-web-ui` as a product-shell must be updated on deletion — added to the structure-doc scope;
   `react-markdown`/`remark-gfm` not carried into either new home.
5. **This verdict recorded** here to satisfy the independent-validation requirement.

Also noted (folded into the spec, not blocking): the webrtc-web↔webrtc mirror is an **asymmetry** — the browser
peer additionally carries `RemoteClient` + `useRtcSession` (transport **+** presentation), consistent with the
repo's loose `agent-transport-*` family (`-tui`/`-gui`).

### [GATE-WRITE] — ✅ PASS | 2026-07-12

**Status upgrade:** draft → review-ready

- Frontmatter: begins with `---`; `status: draft`; `type: INFRA` (valid 11-prefix value); `tags:` present (non-empty array). PASS.
- Problem: concrete — names three bundled responsibilities with specific file paths (`SessionMonitor.tsx`, `src/client/rtc-*.ts`, `spa/index.html`/`remote.html`) and the exact CLI serve mechanism (`copy-web-assets.mjs`); reproduction condition stated ("After GUI-005, `packages/agent-web-ui` still bundles…"); no TBD/TODO/vague single-sentence. PASS.
- Architecture Review Checklist: all 6 items `[x]`; sibling/mirror-analog scan `[x]` with evidence per surface (SessionMonitor↔SessionSurface, webrtc-web↔webrtc, agent-web-monitor↔agent-app); no-cycle/contract-pure `[x]`. PASS.
- Alternatives Considered: ≥2 entries with pro/con — B (REJECTED: pulls pairing into core), C (pro: lighter/no new app; con: transport package owning app html+Tailwind = layer-mixing), D (REJECTED: does not absorb per owner directive), plus app-count note. Decision references the driving trade-off (clean app/transport split vs. layer-mixing) and names Design C as the reduced-scope fallback. PASS.
- New-surface placement: present and surfaced FIRST as the primary decision; each new surface mirrors a named existing analog and reuses at the shared-core level; independently validated by proposal-review (recorded above — REVISE → placement ENDORSED, 5 corrections applied). PASS.
- Completion Criteria: TC-01 … TC-06, every item TC-N prefixed; each in command/observable-behavior form; none use the banned vague phrases ("works correctly", "no errors", "implemented", "displays correctly"). PASS.
- Test Plan: `## Test Plan` present; 6 rows (TC-01…TC-06) — count matches the 6 Completion Criteria exactly; each row has a non-empty Test Type + Tool/Approach (command / headless-browser agent-owned / command-e2e / harness-static); no "manual" tool rows (TC-03 is agent-owned Playwright, not manual). PASS.
- Structure: `## Tasks` present with GATE-IMPLEMENT placeholder; no `## Status` or `## Classification` body sections. `## Evidence Log` is non-empty by design — it carries only the New-Surface-mandated independent placement-validation entry (proposal-review), which `spec-workflow.md` "New-Surface Architecture Placement" requires be recorded before GATE-APPROVAL; no prior gate PASS/FAIL entries pollute it. Treated as compliant. PASS.

TC-N count reconciliation: Completion Criteria = 6 (TC-01…TC-06); Test Plan = 6 (TC-01…TC-06). Match confirmed.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-12

**Status upgrade:** review-ready → approved

- Explicit owner approval directed at this spec, in the current conversation, via the GATE-APPROVAL question
  (asked in Korean at the owner's request) — owner answered verbatim: **"Design A (권장)"**. Unambiguous
  authorization of the recommended full-absorption design (SessionMonitor→core; browser-remote→NEW
  `packages/agent-transport-webrtc-web`; CLI-served SPA→NEW `apps/agent-web-monitor`; delete `agent-web-ui`).
- Placement decision surfaced FIRST + independently validated (proposal-review round 1: REVISE → placement
  ENDORSED, 5 corrections applied) per the New-Surface Architecture Placement rule.
- No Architecture Review or frontmatter type/tags modified after approval.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-12

**Status upgrade:** approved → in-progress

- Prior-gate precondition: GATE-APPROVAL ✅ PASS (2026-07-12), owner verbatim "Design A (권장)"; frontmatter was
  `status: approved` in `todo/` — correct input stage.
- Tasks file exists + path recorded: `.agents/tasks/GUI-006.md` (git-tracked); spec `## Tasks` references it.
- Tasks map to every Completion Criterion: T2→TC-02, T3→TC-01, T4→TC-03, T5→TC-04/05, T6→TC-06 (plus T1
  GATE-IMPLEMENT, T7 merge, T8 GATE-COMPLETE).
- Test Plan present in the task file (TC-01..TC-06 rows, ≥50 chars) satisfying the `test-plans` scan.
- Spec moved `todo/ → active/`; frontmatter `status: in-progress`.
