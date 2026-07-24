---
status: draft
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
   `TCommandEffect` (`src/command-contracts.ts:107-125`) includes `plugin-tui-requested` (line 113) and
   `settings-tui-requested` (line 115). A supposedly transport-neutral SSOT contract says "TUI".
2. **`agent-transport-tui`** — the ONLY consumer of effects, and it executes **side-effectful action
   semantics inside the UI package**: `applyCommandEffects` (`src/hooks/command-effect-handler.ts`)
   handles all 14 effect kinds; `applyLanguageEffect`/`applySettingsResetEffect` (lines 87-108) write
   settings files via `cliAdapter.writeSettings`/`deleteSettings` and trigger process restart — business
   logic living in an Ink renderer. `useSlashRouting.ts:95-115` applies "immediate" effects
   (`conversation-history-cleared`, `plugin-registry-reload-requested`) and queues the rest via
   `CommandEffectQueue` — all TUI-local.
3. **`agent-transport-protocol`** — the WS handler **strips effects**: a remote `command` message is
   executed and answered with `command_result` carrying only `message`/`success`/`data`
   (`src/ws-handler.ts:319-327`); `result.effects` is dropped on the floor. `TServerMessage` has no
   effect/intent carrier (`src/ws-protocol.ts`).
4. **`agent-transport-gui`** — consequently the GUI/web surface can render asks and permissions
   (`src/hooks/prompt-state.ts`) but a command that "acts" does nothing: `/language ko` replies with a
   message and never changes the language; `/settings`, `/plugin`, `/agent`, `/session resume` reply and
   open nothing, with no "unsupported here" signal.
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
   13 effect kinds bypass the host and land in the TUI.

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
  `TCommandHostAction` + `TCommandUiIntent`; add the `ui_intent` session event + `IUiIntentEvent`.
- `packages/agent-framework` — host-action executor in the `executeCommand` pipeline (generalizing the
  existing `provider-hot-swap-requested` handling) driven by `ICommandHostAdapters`; `ui_intent`
  emission (requester-routed, fire-and-forget, listener-count-aware like `SessionPromptRegistry`).
- `packages/agent-command` — emitters switch to the split contract; no logic change.
- `packages/agent-transport-tui` — becomes a pure renderer: delete
  `applyLanguageEffect`/`applySettingsResetEffect` (and their `cliAdapter` settings writes); map
  `ui_intent`s to the existing screens (plugin TUI, settings TUI, session picker, agent switcher).
- `packages/agent-transport-protocol` — forward `ui_intent` in `TServerMessage` (same pattern as
  `ask_request`); `command_result` unchanged (host actions are applied host-side before it is sent).
- `packages/agent-transport-gui` — render supported intents; explicit "not available on this surface"
  notice for unsupported ones (no more silent drop).
- `packages/agent-transport` — nothing to render (headless/programmatic); host actions now work there
  via adapters; document the zero-listener no-op for intents.
- `packages/agent-cli` — composition root: supply the `process` adapter (exit/restart) and keep
  `settings`/`plugin`/`remoteControl` adapters as the single wiring point; remove the TUI-side
  `cliAdapter` settings-write path from effect handling.

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
- [x] Sibling scan 완료 — all 14 `TCommandEffect` kinds classified (see Decision table); all effect
      emitters in `agent-command` enumerated (settings, plugin, language, reset, exit, agent, session,
      remote-control, statusline, provider ×3); all consumers enumerated (TUI `command-effect-handler` /
      `useSlashRouting` / `CommandEffectQueue`; session-level hot-swap; WS handler drop site); the
      `SessionPromptRegistry`/`ask_request` broadcast seam confirmed as the delivery precedent.
- [x] 대안 최소 2개 검토 완료 (4 above)
- [x] 결정 근거 문서화 완료 (prior-art + placement call above)

## Decision

Adopt Alternative 4. Target layering — **Command → (Host Action | UI Intent) → Surfaces**:

```
Command (agent-command)             Host (agent-framework session)          Surfaces (per transport)
───────────────────────             ──────────────────────────────          ────────────────────────
returns hostActions[]           →   executeCommand pipeline applies         state reflected via existing
  (language-change, settings-       them via ICommandHostAdapters           session events (all surfaces,
  reset, exit/restart, hot-swap,    (settings/process/plugin/…),            incl. zero attached)
  statusline-patch, registry-       BEFORE returning the result
  reload, remote-control, …)
returns uiIntents[]             →   session emits `ui_intent`           →   requesting surface renders
  (show-settings, show-plugin-      (requesterDriverId-stamped,             (Ink screen / GUI panel);
  manager, show-session-picker,     fire-and-forget)                        others ignore; unsupported ⇒
  show-agent-switcher)                                                      visible notice, never silent
```

Classification of the existing 14 effect kinds:

| Host actions (session executes)                                                                                                                                                                                                                                            | UI intents (surface renders)                                                                                                                                                                       | Session-state notifications (already events / result data)                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `language-change-requested`, `settings-reset-requested`, `session-exit-requested`, `session-restart-requested`, `provider-hot-swap-requested` (already host-side), `statusline-settings-patch`, `plugin-registry-reload-requested`, `remote-control-enable/stop-requested` | `plugin-tui-requested` → `show-plugin-manager`, `settings-tui-requested` → `show-settings`, `session-picker-requested` → `show-session-picker`, `agent-switcher-requested` → `show-agent-switcher` | `session-renamed`, `conversation-history-cleared`, `session-execution-started` |

Key mechanics:

- **Host actions execute with zero surfaces attached** (headless parity — the LSP/VS Code model). The
  `process` adapter (exit/restart) is supplied by `agent-cli` for every mode (TUI, serve, print); the
  TUI's `requestShutdown` becomes a reaction to the session's existing end-of-life flow, not the
  executor.
- **UI intents are requester-routed**: stamped with the active turn's driver id (same
  `getActiveDriverId` source `SessionPromptRegistry` uses); the surface that issued the command renders
  it; other surfaces ignore it. No parking, no response promise (fire-and-forget) — unlike asks, an
  intent needs no answer. A surface that receives an intent it cannot render prints/report an explicit
  "not available on this surface" notice (prior-art: `showDocument`'s success signal; v1 keeps this
  surface-local, no return channel).
- **Naming is UI-neutral** (`show-*`, never `*-tui-*`), enforced by a TC (grep floor) so the defect
  cannot regrow.

### Staged migration plan (each stage independently green, revertible, own PR)

This cannot be one big-bang PR. Additive-then-delete, the Phase-1 pattern:

- **Stage A — contract (additive).** `agent-interface-transport`: add `TCommandHostAction`,
  `TCommandUiIntent`, `ICommandResult.hostActions?`/`.uiIntents?` alongside the deprecated `effects`,
  plus `IUiIntentEvent` + `ui_intent` in `IInteractiveSessionEvents`. Nothing consumes yet; workspace
  typecheck green.
- **Stage B — host executor.** `agent-framework`: generalize the `executeCommand` hot-swap block into
  an ordered host-action applier over `ICommandHostAdapters`; emit `ui_intent`; add a temporary
  internal `effects → hostActions/uiIntents` mapping shim so ALL existing command emissions gain host
  execution in this stage without touching `agent-command`. `agent-cli`: supply the `process` adapter.
  (Behavior change contained here: language/reset/exit now execute host-side; the TUI's duplicate
  application becomes a no-op guarded by result stripping — applied actions are removed from the
  returned result, exactly like hot-swap today.)
- **Stage C — TUI to pure renderer.** `agent-transport-tui`: subscribe to `ui_intent` for the four
  screens; delete `applyLanguageEffect`/`applySettingsResetEffect`, the `cliAdapter` write path in
  effect handling, and the dead branches of `applyCommandEffects`/`CommandEffectQueue`.
- **Stage D — remote surfaces.** `agent-transport-protocol`: forward `ui_intent` (server→client) next
  to `ask_request`; `agent-transport-gui`: render `show-session-picker`/`show-settings` equivalents it
  has, explicit notice for the rest; `agent-transport`: headless/programmatic docs + tests for
  host-action parity.
- **Stage E — source migration + deletion.** `agent-command`: emit `hostActions`/`uiIntents` directly;
  remove the Stage-B shim, `TCommandEffect`, `ICommandResult.effects`, and all `*-tui-requested`
  names. Workspace-wide grep floor goes green.

## Completion Criteria

- [ ] TC-01: `pnpm --filter @robota-sdk/agent-interface-transport test` → exits 0; a type test asserts
      `TCommandHostAction`/`TCommandUiIntent` are exported, `TCommandUiIntent` names contain no
      UI-technology token, and `IUiIntentEvent` carries `requesterDriverId?`.
- [ ] TC-02: `pnpm --filter @robota-sdk/agent-framework test` → exits 0; tests drive `executeCommand`
      with a stub `ICommandHostAdapters` and assert: `language-change` writes via the settings adapter
      and requests restart via the process adapter; `settings-reset` deletes and requests exit;
      applied host actions are stripped from the returned result; a UI intent emits exactly one
      `ui_intent` stamped with the active driver id; **zero attached surfaces** still applies host
      actions (headless parity).
- [ ] TC-03: WS driver e2e (`agent-transport-protocol`/`agent-cli` serve tests): a remote `command`
      message running a language change results in a settings-adapter write host-side (asserted via
      injected adapter) — proven RED first against the pre-stage-B code where `ws-handler` drops
      effects.
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

## Test Plan

Strategy (FLOW + multi-surface): contract type tests; host-executor unit tests with stub adapters
(incl. the zero-surface case); a red-first WS e2e proving the remote drop is fixed; PTY regression for
the TUI screens; GUI state-fold tests; grep + typecheck floors for migration completeness.

| TC-ID | Test Type        | Tool / Approach                                 | Notes                                                                                 |
| ----- | ---------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| TC-01 | DATA / type      | vitest type test in `agent-interface-transport` | split contract exported; neutral naming asserted at type level                        |
| TC-02 | BEHAVIOR         | vitest, stub `ICommandHostAdapters`             | host execution, result stripping, requester-stamped `ui_intent`, headless parity      |
| TC-03 | FLOW (websocket) | vitest e2e over `ws-handler`                    | remote command applies host action — observed FAILING pre-fix (accidental-green rule) |
| TC-04 | SCREEN (cli)     | vitest + PTY (`*.ptytest.ts`) + `rg` absence    | screens still open via intents; renderer contains no settings I/O                     |
| TC-05 | SCREEN (gui)     | vitest state-fold tests                         | supported intent renders; unsupported intent yields an explicit notice                |
| TC-06 | RULE             | `rg` absence check                              | no `*-tui-requested` / `TCommandEffect` in production code                            |
| TC-07 | BEHAVIOR         | `pnpm -w typecheck`                             | final-state compile = migration completeness                                          |
| TC-08 | INFRA            | `pnpm harness:scan`                             | repo mechanical gates                                                                 |

## Tasks

- [ ] `.agents/tasks/CMD-004-phase2.md` — to be created at GATE-IMPLEMENT (stages A–E mapped to TC-01..TC-08).

## Evidence Log

(empty — populated by gates)
