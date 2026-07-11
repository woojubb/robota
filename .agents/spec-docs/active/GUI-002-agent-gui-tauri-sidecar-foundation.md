---
status: in-progress
type: INFRA
tags: [desktop, tauri, sidecar, gui, react, websocket]
---

# GUI-002: agent-gui — Tauri + sidecar foundation (Stage 1 MVP)

> Parent: [GUI-001](../../backlog/completed/) research-first backlog. This is the **foundational
> architecture spec** for `agent-gui` and the **Stage 1 MVP** it authorizes. It records the two
> owner-decided forks (Tauri v2 shell; spawn-the-CLI-sidecar hosting) so GATE-APPROVAL reviews the
> decision, then authorizes a first buildable stage. Later stages (per-OS packaging/signing, richer
> co-drive UI, in-process option if ever wanted) are separate specs.

## Problem

`agent-cli` drives a live `IInteractiveSession` through a **thin TUI presentation layer**
(`@robota-sdk/agent-transport-tui`) — a display/interaction surface over the transport-neutral session
contract (`@robota-sdk/agent-interface-transport`). Session logic, command routing, permission/ask
prompts (REMOTE-007), and co-drive attribution (REMOTE-014) all live BELOW the presentation layer; the
TUI is "just another surface".

**Concrete symptom / gap:** there is no graphical surface today — the only way to drive a session is the
terminal TUI (`agent-cli`). A user who wants a windowed desktop app (`agent-gui` in the dock/Start menu,
clickable permission prompts, no terminal) has nothing to run; `apps/` contains no desktop shell and no
`robota`-driven GUI application.

We want **`agent-gui`**: a graphical **desktop application** driven by the SAME session contract, whose
GUI presentation layer mirrors the TUI layer's role and architecture (same seams, the OWNER PRINCIPLE
local == remote). The hard question is not "how do we render a session" — a React surface that renders a
live session over the wire **already exists** (`@robota-sdk/agent-web-ui`: conversation, tools, streaming,
permission/ask, driver-attribution chips) — but **how a desktop app should host the session and which
shell technology to use**, without duplicating session logic or forking the distribution direction.

## Architecture Review

### Affected Scope

Research (GUI-001 phase 1, read-only) established the reusable substrate and the decision space:

- **The TUI presentation-layer contract** (what a GUI surface must satisfy): construct or receive an
  `IInteractiveSession`; subscribe to the 15 `IInteractiveSessionEvents`
  (`user_message`, `text_delta`, `tool_start`/`tool_end`, `thinking`, `complete`, `interrupted`,
  `error`, `context_update`, `compact`, `skill_activation`, `memory_event`,
  `execution_workspace_event`, and the REMOTE-007 trio `permission_request`/`ask_request`/
  `prompt_resolved`) and fold them into a view model; drive via `submit` / `executeCommand` / `abort` /
  `cancelQueue` / `shutdown` / `getFullHistory` / `getContextState` /
  `getExecutionWorkspaceSnapshot`; render + answer permission via `resolvePermission(id,result)` and ask
  via `resolveAsk(id,response)`, dismissing on `prompt_resolved`.
- **`agent-web-ui` already implements ~80–90% of this** as a browser-only React library. Its
  `useSessionClient(makeClient)` reducer is **transport-agnostic** (a pluggable `TMakeSessionClient`
  factory over `{onMessage(TServerMessage), onStatusChange}`); it ships a WS client
  (`createWsSessionClient`, localhost sidecar) and a WebRTC client. `ConversationView`,
  `PermissionPrompt`, `AgentActivityPanel`, `prompt-state` cover REMOTE-007 + REMOTE-014 today.
  Dependencies are browser-clean (no `node:` imports; React + the three transport-contract packages).
- **The session is Node-side** (providers, tools, `node:fs`, `child_process` for subagent worktrees,
  `ws`, `werift`). A pure system-webview (Tauri) cannot host it in-process — but it need not: agent-cli
  already exposes the session as a **loopback WebSocket server** (`WsTransport`, `127.0.0.1:7070`,
  `defaultEnabled:true`), and `agent-web-ui` already targets exactly that (`apps/agent-web` monitor
  connects to `ws://localhost:7070`). The runtime workspace closure was verified pure-JS by INFRA-028
  (no native modules). DIST-001/002/003 _aim_ to produce a single-file Bun-compiled `robota` binary with
  a Node-less install path, but **DIST-001 is a `todo` compatibility spike, not a shipped fact** — it
  explicitly flags `bun --compile` unknowns including the `node` child-spawn the session uses for subagent
  worktrees. So GUI-002 must NOT hard-depend on the Bun binary: it spawns _a_ `robota` executable, with the
  ordinary **Node `robota` entrypoint as the Stage-1 dev-run sidecar**; adopting the Bun single-binary is a
  later optimization gated on DIST-001, not a Stage-1 requirement.
- **The loopback WS is UNAUTHENTICATED today.** `WsTransport` (`defaultEnabled:true`) runs
  `new WebSocketServer({ server })` with no `verifyClient`, no origin check, no token — and on every
  connection immediately emits full history + execution-workspace snapshot, then wires the socket to
  `createWsHandler` (which can `submit`, `executeCommand`, and **answer permission/ask prompts**). Because
  browser `WebSocket` connections are not gated by CORS, **any local process — or any web page open in any
  browser on the machine — can currently reach `ws://127.0.0.1:7070` and fully drive/authorize a running
  session.** That is a pre-existing OWNER-PRINCIPLE hole (permission-answering _is_ the authorization gate),
  independent of the GUI. GUI-002 must therefore treat loopback auth as a REQUIRED gate, not an add-on.

### Alternatives Considered (the two forks)

**Fork A — desktop shell.** Tauri v2 (Rust core + system webview; ~5–15 MB shell; no Node in the
webview) vs Electron (bundled Chromium + Node; ~90–150 MB; uniform rendering). **Owner decision: Tauri
v2.** Rationale: a system-webview shell is the cleaner match for a display-only surface over a separate
runtime process; it yields the smallest bundle and needs no native-dep handling. It _can_ later adopt the
DIST-001 Bun single-binary as its sidecar for a single CLI+GUI artifact **if that spike succeeds** (a
Node-less-install upside that is gated on DIST-001, not assumed here) — but Stage 1 spawns the Node
`robota` entrypoint and depends on no unproven toolchain. Cost accepted: introduces **Rust** (shell glue
only — spawn sidecar, window, tray — never domain logic, which stays TypeScript) and requires **Linux
WebKitGTK QA** (the least uniform of the three system webviews).

**Fork B — session hosting.** Spawn the CLI as a **loopback-WS sidecar** vs host the session
**in-process** in a Node runtime. **Owner decision: sidecar.** Rationale: reuses the entire existing
WS surface (REMOTE-007 permission/ask, REMOTE-014 attribution, OWNER PRINCIPLE) with near-zero new
transport code — it is literally what `apps/agent-web` already does. In-process hosting would require a
Node runtime in the shell (forcing Electron) and directly contradicts the Bun single-binary direction.

**Package shape (consequence of A+B).** REUSE `agent-web-ui` as the presentation substrate rather than
fork a new `agent-transport-gui`. A new `apps/agent-gui` owns ONLY the Tauri shell + sidecar
lifecycle + loopback wiring (its own product assembly, per the "no shared product factory" rule). Any
GUI-only presentation seam that emerges is added _inside_ `agent-web-ui`, not a parallel package.

### Decision

Build `agent-gui` as a **thin Tauri v2 desktop shell** that (1) on launch **spawns a `robota` sidecar**
(the Node entrypoint for Stage 1; the DIST-001 Bun single-binary later, gated on that spike) with the WS
transport enabled on a loopback port and a **required launch-nonce loopback auth**; (2) loads the existing
**`agent-web-ui` React SPA** in its system webview,
pointed at `ws://127.0.0.1:<port>`; (3) reuses `agent-web-ui`'s session reducer + rendering verbatim —
**no session/command/permission logic in the GUI**. The GUI is one more driver surface over the
transport-neutral session; the OWNER PRINCIPLE (local == remote) and co-drive attribution (REMOTE-014)
apply to it unchanged.

**Stage 1 (this spec) delivers the MVP:** a desktop window that starts, spawns + supervises the sidecar,
renders a live session (conversation, streaming, tools), and renders + answers permission/ask prompts —
the core user story. It ships the app in dev/run form; **per-OS packaging + code-signing/notarization is
a later spec (GUI-003)**.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — see **Affected Scope** + **Affected Files** (new `apps/agent-gui`;
      reuse `agent-web-ui`; possible additive nonce option in a transport package; `project-structure.md`).
- [x] Sibling scan 완료 — the "render a live session" surface already exists as a SIBLING (`agent-web-ui`,
      the browser React surface, and `apps/agent-web` which mounts it over loopback WS); this spec REUSES that
      sibling as the presentation substrate rather than forking a new `agent-transport-gui` — `apps/agent-gui`
      adds ONLY the Tauri shell + sidecar lifecycle. The TUI sibling (`agent-transport-tui`) is the
      architectural mirror (thin surface over the transport-neutral session), not code to copy. N/A: no new
      shared presentation package is introduced.
- [x] 대안 최소 2개 검토 완료 — two forks each with ≥2 options: shell (Tauri vs Electron) and hosting
      (sidecar vs in-process); see **Alternatives Considered**.
- [x] 결정 근거 문서화 완료 — see **Decision** (Tauri+sidecar; rationale = DIST-alignment + zero session-logic
      duplication + smallest bundle; costs = Rust glue + Linux WebKitGTK QA + loopback-nonce surface).

**Design invariants this spec must hold** (checked at implementation + review):

- **Dependency direction:** `apps/agent-gui` → `agent-web-ui` (browser export) + the contract packages;
  never inverts. The GUI does not depend on `agent-framework`/`agent-core` (the sidecar owns the runtime).
- **Frontend rule:** React only (satisfied — reuses `agent-web-ui`). Tailwind-only styling (the shell
  supplies the theme CSS variables the components consume).
- **No shared product factory:** `apps/agent-gui` owns its own composition; reuse comes from the shared
  lower layer (`agent-web-ui`), not a shared assembler.
- **OWNER PRINCIPLE:** the GUI is a driver surface; attribution is display-only, never authorization.
- **No native modules:** runtime closure is pure-JS (INFRA-028). The Stage-1 sidecar is the Node `robota`
  entrypoint; the Bun single-binary is a later, DIST-001-gated substitution, not a Stage-1 dependency.
- **Loopback auth is REQUIRED (not optional):** the GUI-spawned sidecar must reject any WS connection that
  does not present the launch nonce, and the check must run **before** any session data is emitted.

## Solution

### Components (Stage 1)

1. **`apps/agent-gui` — Tauri v2 project.**
   - `src-tauri/` (Rust): window creation; **sidecar spawn** via Tauri's external-binary (sidecar)
     feature; a `src-tauri/tauri.conf.json` that (a) declares the `robota` sidecar binary, (b) restricts
     the webview to the bundled SPA + the loopback WS origin, (c) sets a strict CSP. The Rust surface is
     minimal glue: spawn the sidecar with the chosen port + nonce, expose the port/nonce to the webview
     (via a Tauri command or an injected `<meta>`), supervise the child (health + shutdown on window
     close), and surface a fatal-spawn error to the UI.
   - `src/` (TS/React): a thin entry that mounts `agent-web-ui`'s session view (composing
     `ConversationView` + `AgentActivityPanel` + `PermissionPrompt` against `useWsSession(url)`, the way
     `RemoteClient` composes for RTC — NOT the WS-hardwired `SessionMonitor`), plus a Tailwind theme
     providing the CSS variables (`--background`, `--card`, `--foreground`, `--primary`, …).
2. **Sidecar contract + REQUIRED loopback auth.** The GUI spawns `robota` with the WS transport on a
   chosen loopback port and a **mandatory launch nonce** (a high-entropy secret minted by the shell per
   launch). The nonce is NOT optional and NOT merely "hostile-local-process" defense — as **Affected Scope**
   documents, the loopback WS is unauthenticated today and reachable by any local process _or any browser
   page_, so without the nonce a co-resident web page could answer permission prompts. Contract:
   - **Mint:** the Rust shell generates the nonce (e.g. 256-bit, `crypto`-grade) and a free loopback port
     at launch; passes both to the child (env var / CLI flag) and to the webview (Tauri command or injected
     `<meta>` — never a world-readable file).
   - **Sidecar side:** the WS transport gains a **required-token option**; the server **rejects the
     handshake (close, no data) BEFORE** the current unconditional `messages` / `execution_workspace_event`
     send when the presented token is absent or wrong. This is a published-surface change to
     `agent-transport-ws` (and possibly `agent-transport-protocol` / `agent-interface-transport` if the
     token check belongs in the shared handler) — **SPEC-first** for the touched package.
   - **Browser transport of the token:** the native `WebSocket` API **cannot set request headers**, so the
     nonce travels via **query param or `Sec-WebSocket-Protocol` subprotocol**; `createWsSessionClient` /
     `useWsSession(url)` are extended (additively) to carry it. The server validates it in the upgrade/first
     frame before any emit.
   - **Pre-existing exposure decision:** GUI-002 closes the hole **for its own sidecar** by requiring the
     token (the GUI never spawns an unauthenticated WS). The **default `defaultEnabled:true` TUI/localhost
     path stays as-is under this spec** and is handed to a **companion SECURITY backlog** (loopback WS auth
     for the default path) rather than silently changed here — a stated decision, not omission.
3. **Lifecycle.** Spawn on app ready → wait for WS readiness → connect the webview. On window close /
   app quit → graceful sidecar shutdown (session `shutdown`), then process kill as a backstop. A sidecar
   crash surfaces a reconnect/fatal state in the UI (reuse the existing `status` surface).

### What Stage 1 explicitly defers

- Per-OS bundling, code-signing, notarization, auto-update → **GUI-003**.
- A `pendingCount` / prompt-queue affordance and richer co-drive UI → later (small; `agent-web-ui` gap).
- Any in-process hosting path → out of scope (owner chose sidecar; would be a distinct spec).
- Multi-session / tabs, settings UI beyond what the session already exposes.

## Affected Files

**New — `apps/agent-gui/`:**

- `package.json` (private app; deps: `@robota-sdk/agent-web-ui`, React, Tailwind, `@tauri-apps/*`).
- `src-tauri/` — `tauri.conf.json`, `Cargo.toml`, `src/main.rs` (spawn/supervise sidecar, port+nonce,
  CSP), `capabilities/` (sidecar + shell scope).
- `src/main.tsx`, `src/App.tsx` (mount agent-web-ui session view), `src/theme.css` (Tailwind tokens),
  `index.html`, `vite.config.ts`, `tsconfig.json`.
- `docs/SPEC.md` (new app spec; also list the sidecar/nonce contract).

**Changed (small, additive):**

- `agent-web-ui` — only if the composed session view needs a new exported seam (prefer reuse; if a
  GUI-tailored root is needed, add it here, not a new package). Possibly export the compose-your-own
  pieces already public.
- `agent-web-ui` — `createWsSessionClient` / `useWsSession(url)` extended (additively) to carry the launch
  nonce via query param or `Sec-WebSocket-Protocol` subprotocol (browser `WebSocket` can't set headers).
- `agent-transport-ws` (and possibly `agent-transport-protocol` / `agent-interface-transport`) — a
  **required-token option** on the WS transport/handler that rejects the handshake **before** any session
  data is emitted. Published-surface contract change ⇒ **SPEC-first** for the touched package.
- `.agents/project-structure.md` — register `apps/agent-gui` + its dependency edges.
- Root build/release wiring — how `agent-gui` obtains the `robota` sidecar (Stage 1: the Node entrypoint;
  Bun single-binary later, gated on DIST-001).

**New backlog (companion, filed by this spec — not implemented here):**

- A **SECURITY backlog** for authenticating the default `defaultEnabled:true` loopback WS path (the
  pre-existing unauthenticated exposure the reviewer surfaced), so the TUI/`apps/agent-web` localhost path
  is not left open after GUI-002 closes it only for its own sidecar.

## Completion Criteria

- [ ] **TC-01** — Observable: launching `apps/agent-gui` (dev run) opens a desktop window that spawns the
      `robota` sidecar and connects the webview over loopback WS; submitting a user turn shows a streaming
      assistant reply and tool cards in the GUI.
- [ ] **TC-02** — Observable: a gated tool call renders a permission prompt in the GUI; clicking Allow/Deny
      answers it via `resolvePermission`, and an ask prompt renders + answers via `resolveAsk`; a
      `prompt_resolved` event dismisses an open prompt.
- [ ] **TC-03** — Observable: a WS connection presenting a missing/wrong launch nonce is rejected by the
      sidecar **before any session data (`messages` / `execution_workspace_event`) is emitted** (the reject
      happens at the handshake/first-frame, not after the snapshot dump); a connection presenting the
      correct nonce — carried via query param or `Sec-WebSocket-Protocol` subprotocol — is accepted.
- [ ] **TC-04** — Observable: closing the window shuts the session down gracefully (session `shutdown`
      called), and a killed/crashed sidecar surfaces a non-hanging fatal/reconnect state in the UI status.
- [ ] **TC-05** — Observable: `apps/agent-gui` declares no dependency on `agent-framework`/`agent-core`;
      the GUI adds no session/command/permission logic (dependency-direction check + review).
- [ ] **TC-06** — Command: `pnpm --filter @robota-sdk/agent-gui typecheck` and the affected `pnpm test`
      pass; `pnpm harness:scan` is green (incl. the new app SPEC doc/structure scans); `.agents/project-structure.md`
      lists `apps/agent-gui` and its dependency edges.

## Test Plan

| TC-N  | Test type            | Tool / approach                                                                                                                                                                                                              |
| ----- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Manual smoke + unit  | Unit: compose-root mounts the session view against a stub `TMakeSessionClient` and renders folded events. Manual: dev-run launch on the dev OS drives a real session (recorded in the app SPEC User Execution scenario).     |
| TC-02 | Unit                 | Prompt render + answer against a mock session surface: Allow/Deny → `resolvePermission`, ask option → `resolveAsk`, `prompt_resolved` → dismiss (reuses `agent-web-ui` prompt-state coverage; GUI compose-root wiring test). |
| TC-03 | Unit                 | Launch-nonce loopback auth: the WS client presents the token; the WS handler/transport accepts the correct nonce and rejects a missing/wrong one (test lives in the touched transport package if the option lands there).    |
| TC-04 | Unit (Rust + TS)     | Rust: sidecar spawn builds the right args (port + nonce); a child-exit maps to the UI fatal state. TS: window-close path invokes graceful `shutdown`; a simulated sidecar drop surfaces the fatal/reconnect status.          |
| TC-05 | Static / review      | Dependency-direction assertion (`apps/agent-gui` package.json has no `agent-framework`/`agent-core` dep) + harness `deps` scan + code review that no session/command/permission logic was added.                             |
| TC-06 | Command (CI/harness) | `pnpm --filter @robota-sdk/agent-gui typecheck`, affected `pnpm test`, `pnpm harness:scan` all green; `.agents/project-structure.md` updated and passing the structure scan.                                                 |

## Tasks

Task file: [`.agents/tasks/GUI-002.md`](../../tasks/GUI-002.md) (execution checklist T1–T10, one task per
TC-N, with the mirrored Test Plan).

- [ ] T1: GATE-APPROVAL — proposal-reviewer ENDORSE of this architecture (the two forks + Stage-1 scope).
- [ ] T2: Scaffold `apps/agent-gui` (Tauri v2 + Vite + React); register in `.agents/project-structure.md`.
- [ ] T3: Rust shell — sidecar spawn + supervise + port/nonce plumbing + CSP + fatal-error surface.
- [ ] T4: TS compose-root — mount `agent-web-ui` session view (ConversationView + AgentActivityPanel +
      PermissionPrompt) against `useWsSession(loopbackUrl)`; Tailwind theme tokens.
- [ ] T5: **Required** launch-nonce loopback auth — SPEC-first update to the touched transport package,
      then: mint in shell → child + webview → WS client carries the token via query param /
      `Sec-WebSocket-Protocol` subprotocol → handler **rejects before any session data is emitted**.
      Extend `createWsSessionClient`/`useWsSession` additively (TC-03).
- [ ] T6: File the **companion SECURITY backlog** (auth for the default `defaultEnabled:true` loopback WS
      path) via backlog-writer — before/alongside implementation, so the pre-existing exposure is tracked.
- [ ] T7: `apps/agent-gui/docs/SPEC.md` (+ sidecar/nonce contract + User Execution scenario); harness
      doc/structure scans green.
- [ ] T8: Tests (Test Plan) + `pnpm typecheck`/affected tests/`harness:scan` green; feature→develop→main
      via merge-verifier at each hop.
- [ ] T9: GATE-COMPLETE — spec active→done; open follow-up backlogs (GUI-003 packaging/signing;
      pendingCount UI; Bun-binary sidecar swap gated on DIST-001).

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-07-12

**Status remains:** draft
**Failed criteria:**

- Frontmatter `type:`: found `ARCHITECTURE`; required exactly one of the 11-prefix list (SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT · INFRA · PERF · SECURITY · OBSERVABILITY). `ARCHITECTURE` is not a valid type value.
  **Required action:** Change `type:` to a valid prefix value (e.g. `INFRA` for a foundation/shell spec).
- Completion Criteria — TC-N prefixes: found 6 plain bullet items with no `TC-N` prefix; required every item prefixed `TC-01`, `TC-02`, … Items without a TC-N prefix = FAIL.
  **Required action:** Rewrite each completion criterion as a `TC-N`-prefixed, command-form or observable-behavior item.
- Test Plan — one row per TC-N: found a 4-item bullet list; required one row per `TC-N` in Completion Criteria with the count matching. No TC-N exist, so no rows can match.
  **Required action:** Convert the Test Plan to a table with one row per TC-N (Test Type + Tool/Approach + Notes), matching the Completion Criteria count.
- Evidence Log empty (first GATE-WRITE run): found a pre-existing 2026-07-12 research note; required empty on first run.
  **Required action:** Move the research note into the Problem/Architecture Review narrative; keep Evidence Log for gate entries only.

Additional observation (not the gating failure): the `## Problem` section frames a design question ("how a desktop app should host the session") rather than a concrete failing symptom + reproduction condition; consider stating the symptom form the GATE-WRITE Problem criteria expect. Frontmatter `status: draft` and `tags:` are present and valid; Tasks section is present with a placeholder; no `## Status`/`## Classification` body sections. The `type` / TC-N / Test-Plan failures block the draft → review-ready upgrade.

### [GATE-WRITE] — ❌ FAIL | 2026-07-12

**Status remains:** draft

Prior-FAIL items now resolved (verified): `type:` is `INFRA` (valid 11-prefix value); Completion Criteria are `TC-01`..`TC-06`, each in Observable/Command form with no banned phrases; Test Plan is a table with exactly 6 rows (one per TC-N), each with a non-empty Test type + Tool/approach; the earlier research note is gone from the Evidence Log; the `## Problem` section now states a concrete symptom ("there is no graphical surface today … `apps/` contains no desktop shell") plus a reproduction condition ("a user who wants a windowed desktop app … has nothing to run"), no TBD/TODO. Frontmatter block present with `status: draft` and `tags:`; Tasks section present with placeholders; no `## Status`/`## Classification` body sections; Alternatives Considered has 2 entries (Tauri v2 vs Electron; sidecar vs in-process) each with pro/con; Decision references the driving trade-offs. The pre-existing FAIL entry is a legitimate historical record (this is a re-run, so a non-empty Evidence Log is expected).

**Failed criteria:**

- Architecture Review Checklist — "All 4 checklist items are `[x]`": found a `### Architecture Review Checklist` section containing 5 bold-labeled design-invariant bullets (Dependency direction, Frontend rule, No shared product factory, OWNER PRINCIPLE, No native modules), NONE of which are `[x]` checkbox items. Required: the canonical 4-item checklist all marked `[x]` (affected packages/layers listed; Sibling scan; ≥2 alternatives reviewed; decision rationale documented), per the passing-spec form.
  **Required action:** Replace/augment the section with the 4 canonical `[x]` checklist items (all checked), keeping the current design-invariant bullets as supporting prose if desired.
- Architecture Review Checklist — "Sibling scan item is `[x]` with completion evidence or explicit `N/A: <reason>`": no Sibling scan checklist item exists anywhere in the document. (Sibling context — the `agent-transport-tui` presentation layer and `apps/agent-web` loopback client — is discussed in the Affected Scope narrative, but not captured as the required `[x]` item.)
  **Required action:** Add a `[x] Sibling scan …` checklist item with the completion evidence (the existing TUI/agent-web narrative can be cited) or an explicit `N/A: <reason>`.

### [GATE-WRITE] — ✅ PASS | 2026-07-12

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: INFRA` (valid 11-prefix value); `tags:` present (`[desktop, tauri, sidecar, gui, react, websocket]`). PASS.
- Problem: concrete symptom ("there is no graphical surface today … `apps/` contains no desktop shell and no `robota`-driven GUI application") + reproduction condition ("A user who wants a windowed desktop app … has nothing to run"); no TBD/TODO/vague single-sentence. PASS.
- Architecture Review Checklist: the prior FAIL is resolved — the section now carries the canonical 4 items ALL `[x]` (영향 패키지/레이어 목록; Sibling scan; 대안 최소 2개; 결정 근거). Sibling scan is `[x]` with completion evidence (`agent-web-ui` + `apps/agent-web` loopback client cited as the reused sibling) plus an explicit `N/A: no new shared presentation package is introduced`. The former design-invariant bullets are preserved below as a separate "Design invariants this spec must hold" note (not part of the checklist). PASS.
- Alternatives Considered: 2 forks, each with ≥2 options and pro/con — shell (Tauri v2 vs Electron: bundle size / Node-in-webview / native-dep trade-offs) and hosting (sidecar vs in-process). Decision references the driving trade-offs (DIST-alignment + zero session-logic duplication + smallest bundle; costs = Rust glue + Linux WebKitGTK QA + loopback-nonce surface). PASS.
- Completion Criteria: TC-01..TC-06, each Observable- or Command-form; no banned phrases ("works correctly"/"no errors"/"implemented"/"displays correctly"); ≥1 criterion per distinct feature. PASS.
- Test Plan: `## Test Plan` table present with exactly 6 rows (TC-01..TC-06) — count matches the 6 Completion Criteria; each row has a non-empty Test type + Tool/approach; TC-01's manual portion carries an inline explanation (dev-run launch drives a real session, recorded in the app SPEC User Execution scenario). PASS.
- Structure: Tasks section present with placeholders (T1–T8); Evidence Log present (two prior FAIL entries are legitimate historical records — non-empty is expected on a re-run); no `## Status`/`## Classification` body sections. PASS.
- TC-N count check: Completion Criteria = 6 (TC-01..TC-06); Test Plan rows = 6 (TC-01..TC-06). Match confirmed.

### [proposal-review] — 🔧 REVISE (round 1) → revisions applied | 2026-07-12

Independent proposal-reviewer (read-only, premises tested against code) endorsed the DIRECTION (Tauri v2
shell + spawn-CLI-loopback-WS-sidecar + reuse `agent-web-ui` verbatim; no superior fork) but returned
REVISE on two load-bearing corrections. Both applied to the spec:

1. **Loopback auth promoted from optional → REQUIRED, fully specified.** The reviewer verified the loopback
   WS is UNAUTHENTICATED today (`WsTransport`, `defaultEnabled:true`, no `verifyClient`/origin/token; dumps
   history + workspace on connect) and reachable by any local process OR any browser page — a pre-existing
   OWNER-PRINCIPLE hole. Spec now: nonce is mandatory for the GUI sidecar; **reject before any session data
   is emitted**; token carried via query param / `Sec-WebSocket-Protocol` subprotocol (native `WebSocket`
   can't set headers); `createWsSessionClient`/`useWsSession` extended additively; SPEC-first on the touched
   transport package; and an explicit decision to **file a companion SECURITY backlog** for the default
   `defaultEnabled:true` path rather than change it silently. TC-03 strengthened to assert reject-before-emit.
2. **DIST-001 Bun-binary premise corrected from settled fact → unproven dependency.** DIST-001 is a `todo`
   compat spike (flags the `node` subagent child-spawn). Spec now spawns the **Node `robota` entrypoint** as
   the Stage-1 sidecar; the Bun single-binary is a later DIST-001-gated swap; dropped "Node-less for free".

Rule-alignment in the review: React-only ✓, dependency direction ✓ (no inversion; the additive nonce edge
is a downward transport-contract change), no-shared-product-factory ✓, no native modules ✓.

### [proposal-review] — 🔧 REVISE (round 2) → single leftover fixed | 2026-07-12

Round-2 confirmed correction #1 (nonce) fully addressed and consistent across Decision/Solution/Affected
Files/TC-03, and correction #2 applied in Affected Scope + Decision + invariants — but caught ONE mechanical
leftover: the **Fork A rationale** still asserted "it ships the _exact_ DIST-001 Bun binary as its sidecar
… the Node-less install story extends for free" (the phrase round 1 said to drop), contradicting the
corrected Decision. Fixed (prose-only): the Fork A rationale now grounds Tauri on system-webview fit +
smallest bundle + no native-dep handling, frames the Bun binary as a later DIST-001-gated _option_ ("if that
spike succeeds"), and states Stage 1 spawns the Node entrypoint. The reviewer pre-authorized ENDORSE
conditional on exactly this edit ("Fix lines 80-84 as above … and this is an ENDORSE"). Round-3 confirmation
requested to record the clean verdict.

### [proposal-review] — ✅ ENDORSE (round 3) | 2026-07-12

Independent proposal-reviewer confirmed the sole round-2 blocker resolved: the Fork A rationale no longer
asserts the Bun binary as fact or claims Node-less-for-free; it is grounded on system-webview fit + smallest
bundle + no native-dep handling, with the Bun single-binary demoted to a DIST-001-gated future option; all
four locations (Fork A / Decision / Affected Scope / invariants) tell the same story; no new inconsistency.
Tauri v2 + sidecar + reuse-`agent-web-ui` endorsed on design-correctness grounds. **The design gate is
satisfied; GATE-APPROVAL now requires the owner's explicit authorization to implement.**

### [GATE-APPROVAL] — ✅ PASS | 2026-07-12

**Status upgrade:** review-ready → approved

- Explicit owner approval directed at this spec, in the current conversation, via the GATE-APPROVAL
  question "authorize implementation of the agent-gui Stage 1 MVP as specified (Tauri v2 shell + Node robota
  sidecar + reuse agent-web-ui + required loopback-nonce auth + companion security backlog)?" — owner
  answered verbatim: **"Approve — build Stage 1 MVP"**. Unambiguous confirmation of the design + authorization
  to implement.
- No Architecture Review or frontmatter `type`/`tags` modified after approval.
- No implementation (file edits / commits) was started before this gate — the three prior review rounds and
  all edits were to the spec document only.

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-07-12

**Status remains:** approved

Prior-gate precondition met: GATE-APPROVAL shows `✅ PASS | 2026-07-12` in this Evidence Log; frontmatter `status: approved` and the `todo/` folder match the expected input stage for GATE-IMPLEMENT.

Criteria checked:

- `.agents/tasks/GUI-002.md` created — PASS (file exists with T1–T10 + a `## Test Plan` section).
- Tasks correspond to Completion Criteria (≥1 task per TC-N) — PASS. Task file maps every TC: T2→TC-01, T3→TC-01/TC-04, T4→TC-01/TC-02, T5→TC-03, T7→TC-06, T8→TC-01..TC-06, T9→TC-05. TC-01..TC-06 all covered.
- Task file `## Test Plan` (≥50 chars) — PASS. `.agents/tasks/GUI-002.md` has a `## Test Plan` section (mirrors the spec's TC-01..TC-06, well over 50 chars). [AF-24]

**Failed criteria:**

- Tasks file path recorded in the `## Tasks` section of the spec: the spec's `## Tasks` section (T1–T9) lists tasks inline but contains no reference to the task file path `.agents/tasks/GUI-002.md`; required — the `## Tasks` section must record the tasks file path so the spec points to its execution tracker.
  **Required action:** Add the task-file path (`.agents/tasks/GUI-002.md`) to the spec's `## Tasks` section (e.g. a `Tasks tracked in .agents/tasks/GUI-002.md` line), then re-run GATE-IMPLEMENT.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-12

**Status upgrade:** approved → in-progress

Prior-gate precondition met: GATE-APPROVAL shows `✅ PASS | 2026-07-12` in this Evidence Log; frontmatter `status: approved` and the `todo/` folder match the expected input stage for GATE-IMPLEMENT.

- `.agents/tasks/GUI-002.md` created — PASS. File exists with tasks T1–T10 and a `## Test Plan` section.
- Tasks file path recorded in the spec `## Tasks` section — PASS (prior FAIL resolved). The `## Tasks` section now opens with ``Task file: [`.agents/tasks/GUI-002.md`](../../tasks/GUI-002.md)`` (spec line 255), so the spec points to its execution tracker.
- Tasks correspond to Completion Criteria (≥1 task per TC-N) — PASS. Task-file mapping covers all six: T2→TC-01, T3→TC-01/TC-04, T4→TC-01/TC-02, T5→TC-03, T7→TC-06, T9→TC-05, T8→TC-01..TC-06. TC-01..TC-06 all covered.
- Task file `## Test Plan` (≥50 chars) — PASS. `.agents/tasks/GUI-002.md` has a `## Test Plan` section mirroring the spec's TC-01..TC-06, well over 50 chars. [AF-24]
