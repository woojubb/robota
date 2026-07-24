---
status: in-progress
type: FLOW
tags: [cli, typescript, websocket, multi-surface, architecture]
---

# CMD-004 (Phase 2): command host-ACTION / UI-intent separation — effects work on every surface

> Formal gate-pipeline spec for the REMAINING scope of the backlog item
> [`.agents/backlog/CMD-004-command-action-ui-separation.md`](../../backlog/CMD-004-command-action-ui-separation.md).
> Phase 1 (the unified `askUser` action seam) is done — spec archived at
> [`done/CMD-004-command-action-ui-separation.md`](../done/CMD-004-command-action-ui-separation.md)
> (same ID by design: this is the same initiative's second and final phase; the frontmatter-scan
> duplicate-ID warning is intentional and accepted).
>
> **Re-scope finding (grounded in current code, 2026-07-24):** the backlog's stated Phase-2 goal —
> "WS + web-ui multi-environment broadcast of the same ask" — was **already delivered by
> REMOTE-007/009**: `SessionPromptRegistry` parks `ask_request`/`permission_request`, broadcasts to
> every attached surface, first `resolveAsk` wins, `prompt_resolved` dismisses co-driving surfaces
> (`packages/agent-framework/src/interactive/session-prompt-registry.ts`), the WS protocol carries all
> three messages (`packages/agent-transport-protocol/src/ws-protocol.ts:96-97`), the TUI subscribes
> (`packages/agent-transport-tui/src/TuiInteractionChannel.ts:603-610`) and the GUI/web renders + answers
> (`packages/agent-transport-gui/src/hooks/prompt-state.ts`). What is NOT done — and is the actual
> residual "command ACTION coupled to UI" defect — is the **command-effect half** below.

## Problem

A slash command's post-execution **actions** are typed as `TCommandEffect` and are executed **only by
the terminal TUI renderer**. Every other surface silently drops them, and the contract itself names a
UI technology. Per package, the current coupling:

1. **`agent-interface-transport`** — the effect contract embeds the renderer in its names:
   `TCommandEffect` (`src/command-contracts.ts:107-125`) is a **16-kind** union that includes
   `plugin-tui-requested` (line 113) and `settings-tui-requested` (line 115). A supposedly
   transport-neutral SSOT contract says "TUI".
2. **`agent-transport-tui`** — the ONLY consumer of effects, and it executes **side-effectful action
   semantics inside the UI package**: `applyCommandEffects` (`src/hooks/command-effect-handler.ts`)
   dispatches the 16-kind effect union; `applyLanguageEffect`/`applySettingsResetEffect` (lines 87-108)
   write settings files via `cliAdapter.writeSettings`/`deleteSettings` and trigger process restart —
   business logic living in an Ink renderer. The TUI even executes the **session-rename mutation
   itself**: `useSideEffects.ts:70-72` (`renameSession`) calls `interactiveSession.setName(name)`,
   while the command does no rename at all (`agent-command/src/session/session-command.ts` —
   `executeRenameCommand` only returns the `session-renamed` effect). `useSlashRouting.ts:95-115`
   applies "immediate" effects (`conversation-history-cleared`, `plugin-registry-reload-requested`)
   and queues the rest via `CommandEffectQueue` — all TUI-local.
3. **`agent-transport-protocol`** — the WS handler **strips effects**: a remote `command` message is
   executed and answered with `command_result` carrying only `message`/`success`/`data`
   (`src/ws-handler.ts:319-327`); `result.effects` is dropped on the floor. `TServerMessage` has no
   effect/intent carrier (`src/ws-protocol.ts`).
4. **`agent-transport-gui`** — consequently the GUI/web surface can render asks and permissions
   (`src/hooks/prompt-state.ts`) but a command that "acts" does nothing: `/language ko` replies with a
   message and never changes the language; `/settings`, `/plugin`, `/agent`, `/session resume` reply and
   open nothing, with no "unsupported here" signal. A remote `/rename` replies "renamed" and renames
   nothing.
5. **`agent-transport`** — the programmatic and headless channels have no effect surface at all
   (`IAgentDriver` in `agent-interface-transport/src/interaction-contracts.ts` exposes events and
   `queueUserAction` only); a headless `/language ko` or `/reset` is a silent no-op.
6. **`agent-command`** — commands correctly emit effects instead of touching UIs (e.g.
   `src/settings/settings-command-module.ts:27`, `src/plugin/plugin-command.ts:122`,
   `src/language/language-command.ts:48`, `src/reset/reset-command.ts:9`, `src/agent/agent-command.ts:44`,
   `src/session/session-command.ts`, `src/remote-control/remote-control-command.ts`,
   `src/statusline/statusline-command.ts:78`) — but the contract they emit into is only honored on one
   surface, so these commands are de-facto TUI-only features.
7. **`agent-framework` / `agent-cli`** — the host layer already has everything needed and doesn't use
   it: `ICommandHostAdapters` (`agent-framework/src/command-api/host-adapters.ts`) defines
   `settings`/`process`/`plugin`/`remoteControl` adapters, built at the composition root
   (`agent-cli/src/startup/command-setup.ts:80-86`); and `InteractiveSession.executeCommand` already
   executes exactly ONE effect host-side — `provider-hot-swap-requested`
   (`agent-framework/src/interactive/interactive-session.ts:987-1009`) — proving the pattern. The other
   15 effect kinds bypass the host and land in the TUI.

Reproduction: attach the GUI (`robota serve` + agent-app) or a WS driver to a session and run
`/language ko` — the reply says the language changed; nothing was written; the TUI on the same session
would have applied it. One command, different semantics per surface: the definition of the
action-coupled-to-UI defect CMD-004 exists to remove.

## Prior Art Research

Researched from product documentation only (prior-art-researcher run, 2026-07-24).

1. **VS Code Commands** — <https://code.visualstudio.com/api/extension-guides/command>. A command is a
   UI-agnostic action bound to an ID; execution is identical whether invoked programmatically or from
   UI. Surfaces (palette, menus, keybindings) are separate declarative contribution points that
   _reference_ command IDs — they never contain the logic.
2. **Language Server Protocol 3.17** —
   <https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/>. Two
   symmetric contracts: `workspace/executeCommand` (client→server; **server executes semantics**) vs
   `window/showMessageRequest`/`window/showDocument` (server→client; server states _what_ to show,
   **client owns rendering** and may decline — `showDocument` returns a success boolean). Capability
   negotiation declares which UI requests a client can render.
3. **Neovim UI protocol** — <https://neo.vimhelp.org/ui.txt.html>,
   <https://neovim.io/doc/user/api-ui-events/>. Core owns all editor state/semantics; UIs attach over
   RPC and only draw; notifications are broadcast to **all attached UIs**; the builtin TUI goes through
   the same protocol as remote GUIs — the terminal is not privileged.
4. **IntelliJ Action System** — <https://plugins.jetbrains.com/docs/intellij/action-system.html>.
   `AnAction.actionPerformed()` holds the executed code; a separate per-place `Presentation` controls
   appearance. Semantics registered once; presentation per-surface.
5. **Redux data flow** — <https://redux.js.org/tutorials/fundamentals/part-2-concepts-data-flow>
   (naming support only): actions are plain typed descriptions of _what happened/is wanted_; handlers
   execute them elsewhere.

**Observed common behavior:** (a) every surveyed system splits _semantic operations executed by the
core/host_ from _presentation requests rendered by whichever frontend is attached_ — none lets a
renderer own side-effectful semantics (our exact defect); (b) names are capability-neutral
(`showDocument`, not "openDialog"/"openTUI"); (c) frontends may decline/not support an intent —
explicit handled/unsupported signals replace silent drops; (d) delivery: state-change notifications
broadcast to all attached UIs, interactive show-and-respond requests go to the requesting party.

**Recommendation (evidence-based):** split `TCommandEffect` into host-executed **actions** (session
layer executes via injected adapters — the LSP `executeCommand` / VS Code model; must work with zero
surfaces attached) and surface-rendered **UI intents** with UI-neutral names (LSP `window/show*`
style), routed to the requesting surface with an explicit unsupported fallback (LSP), while
state-change notifications broadcast to all surfaces (Neovim).

## Architecture Review

### Affected Scope

- `packages/agent-interface-transport` — contract SSOT: replace `TCommandEffect` with
  `TCommandHostAction` + `TCommandUiIntent`; add the `ui_intent` session event + `IUiIntentEvent`;
  extend the `executeCommand` contract with the invoking driver id (see Key mechanics).
- `packages/agent-framework` — host-action executor in the `executeCommand` pipeline (generalizing the
  existing `provider-hot-swap-requested` handling) driven by `ICommandHostAdapters`; `ui_intent`
  emission (requester-routed, fire-and-forget, listener-count-aware like `SessionPromptRegistry`);
  `ICommandRemoteControlAdapter` gains `enable()`/`stop()`.
- `packages/agent-command` — emitters switch to the split contract; no logic change.
- `packages/agent-transport-tui` — becomes a pure renderer: delete
  `applyLanguageEffect`/`applySettingsResetEffect` (and their `cliAdapter` settings writes), the
  `renameSession` mutation, and the statusline self-write; map `ui_intent`s to the existing screens
  (plugin TUI, settings TUI, session picker, agent switcher).
- `packages/agent-transport-protocol` — forward `ui_intent` in `TServerMessage` (same pattern as
  `ask_request`); pass the WS surface's server-assigned driver id into `executeCommand`;
  `command_result` unchanged (host actions are applied host-side before it is sent).
- `packages/agent-transport-gui` — render supported intents; explicit "not available on this surface"
  notice for unsupported ones (no more silent drop).
- `packages/agent-transport` — nothing to render (headless/programmatic); host actions now work there
  via adapters; document the zero-listener no-op for intents.
- `packages/agent-cli` — composition root: supply the `process` adapter (exit/restart, late-bound
  per-mode) and keep `settings`/`plugin`/`remoteControl` adapters as the single wiring point; remove
  the TUI-side `cliAdapter` settings-write path and the TUI-prop remote-control wiring from effect
  handling.

**Architecture-placement call (surfaced explicitly, per the arch-placement lesson — this is the #1
owner-critical decision):**

- The split contract stays SSOT in **`agent-interface-transport`** — NOT `agent-core`. Phase 1 moved
  `IActionRequest` to `agent-core` because `agent-tools` (tool execution) had to reach it. Host
  actions/UI intents are **command-layer** concepts consumed only by `agent-framework` and transports,
  all of which already see `agent-interface-transport`; hoisting them to `agent-core` would widen the
  zero-dependency core with no consumer that needs it.
- Host-action **execution** lives in the **`agent-framework` session layer** (the host), with all I/O
  behind `ICommandHostAdapters` injected from the `agent-cli` composition root — the proven
  `provider-hot-swap-requested` + `permissionHandler`/`askHandler` placement. No new package, no new
  layer; this mirrors the analogous existing seams rather than growing a skin on a sibling.
- UI-intent **rendering** is per-transport, exactly like ask rendering after Phase 1.

### Alternatives Considered

1. **Forward `effects` over WS as-is and let each remote surface re-implement application logic.**
   - Pro: smallest diff (serialize the existing union into `command_result`).
   - Con: duplicates side-effectful semantics per surface (settings writes from a browser are
     impossible/wrong); keeps `*-tui-requested` names; headless still broken (no surface = no
     execution). Rejected — it multiplies the defect instead of removing it.
2. **Make everything a host action (no UI intents).** "Open settings" would become host-driven ask
   flows over the Phase-1 `askUser` seam.
   - Pro: single mechanism.
   - Con: screen navigation is inherently surface-owned (the plugin browser, session picker and agent
     switcher are full screens, not one-question dialogs); forcing them through `IActionRequest`
     re-couples rendering by impoverishing it. Rejected — prior art (LSP `window/*`, Neovim external
     UI elements) keeps a distinct presentation-request class.
3. **Make everything a broadcast UI event (no host execution)** — the status quo generalized to all
   surfaces.
   - Con: N surfaces each write settings/restart the process; races and double-writes with two
     surfaces attached; zero surfaces = nothing happens. Rejected.
4. **Split: host-executed `TCommandHostAction` (session executes via `ICommandHostAdapters`, works
   headless, results reflected to all surfaces) + requester-routed `TCommandUiIntent` (UI-neutral
   names, explicit unsupported fallback) — CHOSEN.**
   - Pro: matches all four surveyed systems; reuses existing adapters and the existing hot-swap
     precedent; fixes remote AND headless in one move; deletes action logic from the renderer.
   - Con: two message classes instead of one (justified: they have different executors, routing and
     failure modes); a migration across 8 packages (staged below; pre-release, no compat constraint).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 (8 packages above)
- [x] Sibling scan 완료 — all 16 `TCommandEffect` kinds classified (see Decision table); all effect
      emitters in `agent-command` enumerated (settings, plugin, language, reset, exit, agent, session,
      remote-control, statusline, provider ×3); all consumers enumerated (TUI `command-effect-handler` /
      `useSideEffects` / `useSlashRouting` / `CommandEffectQueue`; session-level hot-swap; WS handler
      drop site); the `SessionPromptRegistry`/`ask_request` broadcast seam confirmed as the delivery
      precedent.
- [x] 대안 최소 2개 검토 완료 (4 above)
- [x] 결정 근거 문서화 완료 (prior-art + placement call above)

## Decision

Adopt Alternative 4. Target layering — **Command → (Host Action | UI Intent) → Surfaces**:

```
Command (agent-command)             Host (agent-framework session)          Surfaces (per transport)
───────────────────────             ──────────────────────────────          ────────────────────────
returns hostActions[]           →   executeCommand pipeline applies         state reflected via existing
  (language-change, settings-       them via ICommandHostAdapters           session events (all surfaces,
  reset, exit/restart, hot-swap,    (settings/process/plugin/…) or          incl. zero attached)
  session-rename, statusline-       directly on the session (rename),
  patch, registry-reload,           BEFORE returning the result
  remote-control, …)
returns uiIntents[]             →   session emits `ui_intent`           →   requesting surface renders
  (show-settings, show-plugin-      (requesterDriverId-stamped from        (Ink screen / GUI panel);
  manager, show-session-picker,     the command's invoking driver id,       others ignore; unsupported ⇒
  show-agent-switcher)              fire-and-forget)                        visible notice, never silent
```

Classification of the existing 16 effect kinds:

| Host actions (session executes)                                                                                                                                                                                                                                                                                                                      | UI intents (surface renders)                                                                                                                                                                       | Session-state notifications (broadcast events / result data) |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `language-change-requested`, `settings-reset-requested`, `session-exit-requested`, `session-restart-requested`, `provider-hot-swap-requested` (already host-side), `session-renamed` (reclassified — see below), `statusline-settings-patch`, `plugin-registry-reload-requested`, `remote-control-enable-requested`, `remote-control-stop-requested` | `plugin-tui-requested` → `show-plugin-manager`, `settings-tui-requested` → `show-settings`, `session-picker-requested` → `show-session-picker`, `agent-switcher-requested` → `show-agent-switcher` | `conversation-history-cleared`, `session-execution-started`  |

**`session-renamed` is reclassified as host-executed, not a notification.** Today it is NOT a mere
notification: the TUI executes the mutation (`agent-transport-tui/src/hooks/useSideEffects.ts:70-72`
`renameSession` calls `interactiveSession.setName(name)`), while the command performs no rename
(`agent-command/src/session/session-command.ts` — `executeRenameCommand` returns only the effect). So a
remote or headless `/rename` currently renames nothing. Target: the **host executes the rename** — the
session pipeline applies a `session-rename` host action directly on the session (`setName`; no adapter
needed, the session owns its own name) — **plus a broadcast** session event so every attached surface
(including co-driving ones) updates its title. Stage C may delete the TUI `renameSession` handler
**only after a red-first test proves `/rename` persists without it** (TC-10).

Key mechanics:

- **Host actions execute with zero surfaces attached** (headless parity — the LSP/VS Code model). The
  `process` adapter (exit/restart) is supplied by `agent-cli` for every mode (TUI, serve, print); the
  TUI's `requestShutdown` becomes a reaction to the session's existing end-of-life flow, not the
  executor.
- **UI intents are requester-routed via an explicit command-origin driver id.** `executeCommand`
  gains an invoking-driver parameter carried through the whole chain:
  `InteractiveSessionBase.executeCommand` (`interactive-session-base.ts:98`) →
  `InteractiveSessionSkillRouter.executeCommand`/`executeCommandWithSource`
  (`interactive-session-skill-router.ts:172,193`) → the WS `command` handler passes its **REMOTE-014
  E5 server-assigned surface driver id** (`ws-handler.ts:36-40,319` — the same
  server-assigned-id rule submit already follows) → the TUI channel passes the local driver id
  (`TuiInteractionChannel.ts:443`, `useSlashRouting.ts:38`). `ui_intent.requesterDriverId` is stamped
  from this parameter. `getActiveDriverId` is used **only as a fallback for model-invoked commands**
  (commands issued from within a running turn, where the active turn's driver IS the correct
  attribution). Rationale: `activeDriverId` is a **turn attribute** — it is null/undefined while a
  remote command executes outside a turn (`ws-handler.ts:82`), so the draft's original "same source
  `SessionPromptRegistry` uses" mechanism cannot attribute remote commands and is rejected. The
  surface that issued the command renders the intent; other surfaces ignore it. No parking, no
  response promise (fire-and-forget) — unlike asks, an intent needs no answer. A surface that
  receives an intent it cannot render prints/reports an explicit "not available on this surface"
  notice (prior-art: `showDocument`'s success signal; v1 keeps this surface-local, no return channel).
- **Multi-surface exit/restart policy (deliberate decision).** Host-executed `session-exit-requested`
  / `session-restart-requested` invoked from a **remote** surface terminate/restart the **shared
  host** that serves ALL attached surfaces. This is intentional, per the owner principle local ==
  remote (REMOTE-006): a remote driver is a full driver, and exit/restart are session-scoped
  semantics, not surface-scoped ones. A surface that only wants to detach disconnects; `/exit`
  ends the session for everyone. Recorded here as a decision and proven by a WS e2e (TC-09).
- **Adapter absence is an explicit failure, never a silent skip** (no-fallback rule). If a host
  action's adapter is not wired in the current composition (e.g. no `process` adapter), the
  executeCommand pipeline returns an explicit failure in the command result naming the missing
  capability — asserted by TC-02.
- **Naming is UI-neutral** (`show-*`, never `*-tui-*`), enforced by a TC (grep floor) so the defect
  cannot regrow.

### Staged migration plan (each stage independently green, revertible, own PR)

This cannot be one big-bang PR. Additive-then-delete, the Phase-1 pattern:

- **Stage A — contract (additive).** `agent-interface-transport`: add `TCommandHostAction`,
  `TCommandUiIntent`, `ICommandResult.hostActions?`/`.uiIntents?` alongside the deprecated `effects`,
  plus `IUiIntentEvent` (carrying `requesterDriverId?`) + `ui_intent` in `IInteractiveSessionEvents`,
  and the invoking-driver-id extension of the `executeCommand` contract. Nothing consumes yet;
  workspace typecheck green.
- **Stage B — host executor.** `agent-framework`: generalize the `executeCommand` hot-swap block into
  an ordered host-action applier over `ICommandHostAdapters` (plus the direct-on-session
  `session-rename`); emit `ui_intent`; add a temporary internal `effects → hostActions/uiIntents`
  mapping shim so ALL existing command emissions gain host execution in this stage without touching
  `agent-command`. Plumb the invoking `driverId` through base → skill-router → WS handler → TUI
  channel (rev-2 chain above). Extend `ICommandRemoteControlAdapter` — currently status-only **by
  documented design** (`agent-framework/src/command-api/host-adapters.ts:31-33`: "only the status
  query is exposed here") — with `enable()`/`stop()` returning the user-facing message, folded into
  the command result; wiring moves off the TUI props (`enableRemoteControl`/`stopRemoteControl` in
  `useSideEffects.ts`) to the composition-root adapter. `agent-cli`: supply a **late-bound per-mode
  `process` adapter** (TUI graceful unmount / serve shutdown / print exit). An absent adapter ⇒
  explicit failure in the command result (no-fallback), never a silent skip.
  **Stripping scope: Stage B strips HOST ACTIONS ONLY from `result.effects`** (applied actions are
  removed from the returned result, exactly like hot-swap today, so the TUI's duplicate application
  becomes a no-op). The four **UI-intent effects stay dual-carried** — legacy effect in
  `result.effects` AND the new `ui_intent` event — until Stage C. The TUI keeps rendering from the
  legacy effect in this stage (it does not yet subscribe to `ui_intent`), so there is no drop window
  and no double-render window.
- **Stage C — TUI to pure renderer.** `agent-transport-tui`: **in the SAME PR**, swap the TUI's
  subscription from legacy effects to `ui_intent` for the four screens AND delete the legacy effect
  branches (dual-carry ends here — a split PR would create a drop or double-render window). Delete
  `applyLanguageEffect`/`applySettingsResetEffect`, the `cliAdapter` write path in effect handling,
  and the dead branches of `applyCommandEffects`/`CommandEffectQueue`. Delete the `renameSession`
  mutation **only after the red-first `/rename` persistence proof (TC-10)**. **Statusline refresh
  path:** today the TUI refreshes its statusline from its OWN write (`useSideEffects.ts:74-78`
  `applyStatusLinePatch` → `cliAdapter.applyStatusLineSettings`); after Stage B the host applies
  `statusline-settings-patch` via the settings adapter, so Stage C makes the TUI **re-read the
  statusline settings when the `command_result` arrives** (refresh-on-result) and deletes the
  TUI-side write.
- **Stage D — remote surfaces.** `agent-transport-protocol`: forward `ui_intent` (server→client) next
  to `ask_request`; `agent-transport-gui`: render `show-session-picker`/`show-settings` equivalents it
  has, explicit notice for the rest; `agent-transport`: headless/programmatic docs + tests for
  host-action parity. WS e2e for the multi-surface exit/restart policy (TC-09).
- **Stage E — source migration + deletion.** `agent-command`: emit `hostActions`/`uiIntents` directly;
  remove the Stage-B shim, `TCommandEffect`, `ICommandResult.effects`, and all `*-tui-requested`
  names. Workspace-wide grep floor goes green. **Final carrier for the former notification kinds
  (decided):**
  - `session-renamed` — the host-executed rename emits a **broadcast session event** (the session's
    existing event stream) so all surfaces, including co-driving ones, update their titles.
  - `conversation-history-cleared` — becomes a **broadcast session event** so co-driving surfaces
    refresh their transcript (today only the clearing TUI refreshes).
  - `session-execution-started` — carried in **`result.data`** (requester-local hint; it changes no
    shared session state the other surfaces must reflect).

## Completion Criteria

- [ ] TC-01: `pnpm --filter @robota-sdk/agent-interface-transport test` → exits 0; a type test asserts
      `TCommandHostAction`/`TCommandUiIntent` are exported, `TCommandUiIntent` names contain no
      UI-technology token, and `IUiIntentEvent` carries `requesterDriverId?`.
- [ ] TC-02: `pnpm --filter @robota-sdk/agent-framework test` → exits 0; tests drive `executeCommand`
      with a stub `ICommandHostAdapters` and assert: `language-change` writes via the settings adapter
      and requests restart via the process adapter; `settings-reset` deletes and requests exit;
      applied host actions are stripped from the returned result; a UI intent emits exactly one
      `ui_intent` stamped with the **invoking driver id passed into `executeCommand`** (and falls back
      to the active turn's driver only for model-invoked commands); **zero attached surfaces** still
      applies host actions (headless parity); **an absent adapter yields an explicit failure in the
      command result** (no-fallback) — never a silent skip.
- [ ] TC-03: WS driver e2e (`agent-transport-protocol`/`agent-cli` serve tests): a remote `command`
      message running a language change results in a settings-adapter write host-side (asserted via
      injected adapter) — proven RED first against the pre-stage-B code where `ws-handler` drops
      effects; **the pre-Stage-B RED run is kept as recorded evidence in the Evidence Log**
      (accidental-green rule).
- [ ] TC-04: `pnpm --filter @robota-sdk/agent-transport-tui test` (incl. PTY) → exits 0; `/settings`
      still opens the settings screen (now via `ui_intent`); `rg -n "writeSettings|deleteSettings"
packages/agent-transport-tui/src/hooks/command-effect-handler.ts` → no matches (renderer no
      longer executes settings I/O). File deleted counts as pass.
- [ ] TC-05: `pnpm --filter @robota-sdk/agent-transport-gui test` → exits 0; folding a `ui_intent`
      server message produces either a mapped GUI surface state or an explicit unsupported-notice
      entry — never a silent no-op.
- [ ] TC-06: `rg -n "tui-requested|TCommandEffect|\beffects\??:" packages/*/src` → no production
      matches after Stage E (grep floor; test files excluded).
- [ ] TC-07: `pnpm -w typecheck` → exits 0 in the final state (old contract removed) — proves every
      consumer migrated.
- [ ] TC-08: `pnpm harness:scan` → exits 0.
- [ ] TC-09: WS e2e (multi-surface policy): with a remote WS surface attached, a remote
      `session-exit-requested` (and `session-restart-requested`) host action terminates/restarts the
      **shared host session** serving all surfaces — asserting the deliberate local==remote
      (REMOTE-006) decision.
- [ ] TC-10: red-first `/rename` persistence proof: a test asserting `/rename` mutates the session
      name **without the TUI's `renameSession` handler** is proven FAILING against pre-Stage-B code
      (where only `useSideEffects.ts` performs the mutation), then green once the host executes the
      rename; Stage C may delete the TUI handler only after this proof.

## Test Plan

Strategy (FLOW + multi-surface): contract type tests; host-executor unit tests with stub adapters
(incl. the zero-surface and adapter-absent cases); red-first WS e2e proving the remote drop is fixed
and a red-first `/rename` persistence proof; a WS e2e for the multi-surface exit/restart policy; PTY
regression for the TUI screens; GUI state-fold tests; grep + typecheck floors for migration
completeness.

| TC-ID | Test Type        | Tool / Approach                                 | Notes                                                                                                                         |
| ----- | ---------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | DATA / type      | vitest type test in `agent-interface-transport` | split contract exported; neutral naming asserted at type level                                                                |
| TC-02 | BEHAVIOR         | vitest, stub `ICommandHostAdapters`             | host execution, result stripping, command-origin-driver-stamped `ui_intent`, headless parity, adapter-absent explicit failure |
| TC-03 | FLOW (websocket) | vitest e2e over `ws-handler`                    | remote command applies host action — observed FAILING pre-fix; RED run recorded in Evidence Log                               |
| TC-04 | SCREEN (cli)     | vitest + PTY (`*.ptytest.ts`) + `rg` absence    | screens still open via intents; renderer contains no settings I/O                                                             |
| TC-05 | SCREEN (gui)     | vitest state-fold tests                         | supported intent renders; unsupported intent yields an explicit notice                                                        |
| TC-06 | RULE             | `rg` absence check                              | no `*-tui-requested` / `TCommandEffect` in production code                                                                    |
| TC-07 | BEHAVIOR         | `pnpm -w typecheck`                             | final-state compile = migration completeness                                                                                  |
| TC-08 | INFRA            | `pnpm harness:scan`                             | repo mechanical gates                                                                                                         |
| TC-09 | FLOW (websocket) | vitest e2e over `ws-handler`                    | remote exit/restart acts on the SHARED host (deliberate local==remote / REMOTE-006 policy)                                    |
| TC-10 | BEHAVIOR         | vitest, red-first                               | `/rename` persists host-side without the TUI handler — proven FAILING pre-Stage-B, then green                                 |

## Tasks

- [x] `.agents/tasks/CMD-004-phase2.md` — created (GATE-IMPLEMENT). Stages A–E mapped to TC-01..TC-10.

## Evidence Log

- **2026-07-24 — GATE-APPROVAL: REVISE (independent proposal-reviewer), revisions folded → approvable.**
  The reviewer APPROVED the architecture — the host-action/UI-intent split, the
  `agent-interface-transport` SSOT placement, and the staged A–E migration were judged "correct and
  well-evidenced" — and concluded that with the eight binding revisions folded in, the decision is
  approvable. The eight revisions, each applied to this document and verified against code on
  develop:
  1. Effect count corrected 14→16 (`command-contracts.ts:107-125` — 16 union members verified);
     `session-renamed` reclassified from notification to **host-executed** (TUI currently executes
     the mutation via `useSideEffects.ts:70-72` `interactiveSession.setName`; the command does no
     rename) + broadcast for title updates; Stage C TUI-handler deletion gated on the red-first
     `/rename` proof (TC-10). → Problem §2, Decision table + reclassification note, Stage C, TC-10.
  2. Explicit command-origin `driverId` on `executeCommand` (base → skill-router → WS handler
     [REMOTE-014 E5 server-assigned id] → TUI channel); `ui_intent.requesterDriverId` stamped from
     it; `activeDriverId` only a fallback for model-invoked commands (it is a turn attribute — null
     during remote commands, so the draft's `SessionPromptRegistry`-source mechanism was rejected).
     → Key mechanics, Stages A/B, TC-02.
  3. Stage B strips **host actions only** from `result.effects`; the four UI-intent effects stay
     dual-carried (legacy effect + `ui_intent`) until Stage C, which swaps the TUI subscription and
     deletes the legacy branches in the SAME PR (no drop window, no double-render window). → Stages
     B/C.
  4. Stage B adapter work made explicit: `ICommandRemoteControlAdapter` extended with
     `enable()`/`stop()` returning the user-facing message (superseding its documented status-only
     design, `host-adapters.ts:31-33`); wiring moved off TUI props; late-bound per-mode `process`
     adapter (TUI unmount / serve shutdown / print exit); absent adapter ⇒ explicit failure in the
     result (no-fallback), never a silent skip. → Stage B, Key mechanics, TC-02.
  5. Multi-surface policy stated and tested: host-executed `session-exit/restart-requested` from a
     remote surface terminates/restarts the shared host — deliberate local==remote (REMOTE-006)
     decision. → Key mechanics, TC-09.
  6. Stage C statusline refresh path defined: TUI re-reads statusline settings on `command_result`
     (today it refreshes from its own write, `useSideEffects.ts:74-78`). → Stage C.
  7. Stage E final carriers decided: `session-renamed` → broadcast session event;
     `conversation-history-cleared` → broadcast session event (co-driving surfaces refresh);
     `session-execution-started` → `result.data`. → Stage E.
  8. Test plan hardened: TC-03's pre-Stage-B RED run kept as recorded evidence; `/rename` red-first
     proof added (TC-10); TC-02 includes the adapter-absent failure case. → Completion Criteria,
     Test Plan.
     Status advanced `draft` → `approved`; document moved `draft/` → `todo/` per the spec-docs
     lifecycle (GATE-APPROVAL PASS → `todo/`).

### [GATE-IMPLEMENT] — Stages A + B ✅ | 2026-07-25

**Status upgrade:** approved → in-progress; document moved `todo/` → `active/`. Tasks file
`.agents/tasks/CMD-004-phase2.md` created (stages A–E mapped to TC-01..TC-10). **Scope of this
entry: Stage A (additive contract) + Stage B (host executor + shim) ONLY — the spec stays
in-progress; Stages C (TUI pure renderer), D (remote surfaces), E (source migration + deletion)
remain.**

Stage A (`agent-interface-transport`, additive): `TCommandHostAction` + `TCommandUiIntent`
(UI-neutral names) beside the untouched legacy `TCommandEffect`; `ICommandResult.hostActions?`/
`.uiIntents?`; `IUiIntentEvent` (`requesterDriverId?`) + `ui_intent` and `session_renamed` in
`IInteractiveSessionEvents`; optional `originDriverId` on the `executeCommand` contract (2/3-arg
callers compile unchanged). Driver-identity contracts split into `driver-contracts.ts` (file-size
ratchet + cohesion). TC-01 (interim, stages A+B scope): `pnpm --filter
@robota-sdk/agent-interface-transport build && npx vitest run` → exit 0, 17 passed (type test
asserts the split export, type-level no-UI-technology-token floor, `requesterDriverId?`, optional
4th param, serializability).

Stage B (`agent-framework` + `agent-transport-protocol` + `agent-cli`):

- Host-action executor `interactive-session-host-actions.ts` generalizes the proven
  `provider-hot-swap-requested` block (org-policy gate preserved); ordered application over
  `ICommandHostAdapters`; direct-on-session `session-rename` + `session_renamed` broadcast;
  applied HOST ACTIONS stripped from `result.effects`; the four UI-intent effects dual-carried
  (legacy effect + `ui_intent` event) until Stage C; notifications pass through. Legacy mapping
  isolated in `command-effect-shim.ts` (deleted in Stage E).
- Adapters: `ICommandRemoteControlAdapter.enable()/stop()` (supersedes the documented status-only
  design) wired at the `agent-cli` root over `RemoteControlController`;
  `ICommandSettingsAdapter.delete?()` for `settings-reset`; late-bound per-mode `process` adapter
  (TUI: deferred SIGTERM through the App's existing graceful signal flow; serve: deferred
  shared-host shutdown — deliberate local == remote / REMOTE-006; print: exit satisfied by the
  end-of-run exit-code contract, restart surfaced explicitly). Absent adapter ⇒ EXPLICIT failure
  in the command result (no-fallback) — never a silent skip.
- ws-handler passes its REMOTE-014 E5 server-assigned driver id as the command origin and forwards
  `ui_intent` server messages (same pattern as `ask_request`).
- **Stage-B shim deviation (recorded per the shim note in `command-effect-shim.ts`):**
  `plugin-registry-reload-requested` is classified a host action by the Decision table, but its
  semantic mutation (`adapter.reloadPlugins()`) already runs host-side INSIDE `/plugin reload`;
  the residual effect is only a surface command-registry refresh signal. Mapping it would
  double-execute the reload (banned by the no-double-execution constraint) and stripping it would
  break the TUI autocomplete refresh before Stage C — it stays a legacy pass-through; Stage C/E
  assigns its final carrier. The `plugin-registry-reload` KIND exists on the split contract for
  Stage-E emitters (host execution: no-op by design, reload already ran in-command).
- Behavioral note: a `switchProvider` error during hot-swap now surfaces as an explicit failure
  RESULT (previously it escaped as a rejected `executeCommand` promise) — no-fallback-conformant
  error-result return.

TC evidence (stages A+B):

- TC-02 — `pnpm --filter @robota-sdk/agent-framework build && npx vitest run` → exit 0, 1238
  passed (148 files). `interactive-session-host-actions.test.ts` (16 tests): language-change
  writes via the settings adapter + `requestRestart('other', 'Language change restart')`;
  settings-reset `delete()` + `requestExit('other')`; applied actions stripped
  (`result.effects === []`); exactly ONE `ui_intent` per intent — stamped `'owner'` for local
  `'user'`, stamped with the explicit `executeCommand(..., 'remote', 'device-42')` origin,
  unattributed for remote-without-id and for idle model-source (the `activeDriverId` fallback's
  idle half; the active-turn half becomes reachable via the CMD-005 model-command path); legacy
  UI-intent effect dual-carried; HEADLESS PARITY (zero listeners attached — actions still
  applied); adapter-absent explicit failures (`Cannot apply 'session-exit': a process adapter is
not available in this environment.`, settings-without-delete, remote-control-without-enable);
  adapter error → explicit failure result; failed command result passes through untouched;
  single-execution call-count assertions; direct `hostActions` (Stage-E shape) executed.
- TC-03 — RED first (pre-Stage-B code, dist built from the Stage-A tree; effects dropped by
  `ws-handler.ts`): `packages/agent-cli` `npx vitest run src/__tests__/ws-command-host-action.test.ts` →
  2 failed: `AssertionError: expected "spy" to be called 1 times, but got 0 times` (the settings
  write never happened for a remote `/language ko`) and `AssertionError: expected [] to deeply
equal [ { type: 'ui_intent', …(1) } ]` (no ui_intent message existed). GREEN after Stage B:
  same command → exit 0, 2 passed — remote `/language ko` writes via the injected settings
  adapter host-side + requests restart; remote `/settings` forwards ONE `ui_intent` stamped
  `requesterDriverId: 'device-e2e-1'` (the handler-injected server-assigned id).
- TC-10 — RED first (pre-Stage-B): `packages/agent-command`
  `npx vitest run src/session/__tests__/rename-host-persistence.test.ts` → 2 failed:
  `AssertionError: expected undefined to be 'My Renamed Session'` (the rename does NOT persist
  without the TUI handler — only `useSideEffects.ts` performed the mutation) and
  `expected "setName" to be called 1 times, but got 0 times`. GREEN after Stage B: exit 0, 2
  passed — `/rename` mutates the session name host-side (`setName` called exactly once),
  broadcasts `session_renamed`, and the applied action is stripped so the untouched TUI handler
  cannot double-rename; the rename message still reaches surfaces via `command_result.message`.
- TUI unaffected (dual-carry + optional-param design, zero TUI edits):
  `pnpm build:deps && pnpm --filter @robota-sdk/agent-transport-tui test` → exit 0, 426 passed
  (59 files); real-binary PTY suite `test:pty` → exit 0, 11 passed (rebuilt CLI with Stage B
  active); `agent-cli` `test:bin` (serve-mode/cross-fidelity bintests) → exit 0, 4 passed.
- Suites: `agent-transport-protocol` 54 passed (ui_intent forward + server-assigned command-origin
  unit tests added); `agent-command` 244 passed; `agent-transport` 50 passed; `agent-cli` 236
  passed; `agent-interface-transport` 17 passed.
- `pnpm -w typecheck` → exit 0. `node scripts/harness/run-all-scans.mjs` → all 59 scans passed
  (file-size ratchet honored by splitting new logic into `driver-contracts.ts`,
  `command-effect-shim.ts`, `interactive-session-host-actions.ts`,
  `startup/host-action-adapters.ts`; `cli.ts` and `session-contracts.ts` shrank below baseline —
  ratchet-tighten notices left for a maintainer `--write-baseline` since `scripts/harness/**` is
  out of this branch's scope).

Remaining for later stages: TC-04 (Stage C TUI swap to `ui_intent` + legacy deletion + statusline
refresh-on-result + TUI `renameSession` deletion under the TC-10 proof), TC-05 (Stage D GUI
render/notice), TC-09 (Stage D multi-surface exit/restart WS e2e), TC-06/07/08 final grep/typecheck/
scan floors after Stage E emitter migration + `TCommandEffect` deletion.
