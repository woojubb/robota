# CMD-004 Phase 2 — command host-ACTION / UI-intent separation (task breakdown)

Spec: `.agents/spec-docs/active/CMD-004-command-action-ui-separation.md`
Status: in-progress — Stages A + B in flight (this branch). Stages C, D, E remain.

Staged migration (additive-then-delete, each stage independently green, own PR):

## Stage A — contract (additive, `agent-interface-transport`) → TC-01, TC-07 (interim)

- [x] Add `TCommandHostAction` + `TCommandUiIntent` (UI-neutral names) alongside the deprecated
      `TCommandEffect` (untouched).
- [x] Add `ICommandResult.hostActions?` / `.uiIntents?` (additive).
- [x] Add `IUiIntentEvent` (carries `requesterDriverId?`) + `ui_intent` in
      `IInteractiveSessionEvents`; add the `session_renamed` broadcast event (host-executed rename
      title propagation).
- [x] Extend the `executeCommand` contract with the OPTIONAL command-origin driver id
      (`originDriverId?`), defaulting so untouched callers compile.
- [x] Type test (TC-01): split contract exported; `TCommandUiIntent` names carry no UI-technology
      token; `IUiIntentEvent.requesterDriverId?` present.

## Stage B — host executor (`agent-framework` + `agent-transport-protocol` + `agent-cli`) → TC-02, TC-03, TC-10

- [x] Generalize the `executeCommand` hot-swap block into an ordered host-action applier over
      `ICommandHostAdapters` (+ direct-on-session `session-rename` with `session_renamed` broadcast).
- [x] Temporary internal `effects → hostActions/uiIntents` mapping shim (Stage E deletes it).
- [x] Strip HOST ACTIONS ONLY from `result.effects`; the four UI-intent effects stay dual-carried
      (legacy effect AND new `ui_intent` event) until Stage C.
- [x] Emit `ui_intent` stamped with the command-origin driver id (model-invoked fallback:
      active turn driver). Fire-and-forget; zero listeners ⇒ no-op.
- [x] Absent adapter ⇒ EXPLICIT failure in the command result (no-fallback), never a silent skip.
- [x] Extend `ICommandRemoteControlAdapter` with `enable()`/`stop()` returning the user message;
      wire at the `agent-cli` composition root. `ICommandSettingsAdapter` gains optional `delete()`.
- [x] `agent-cli`: late-bound per-mode `process` adapter (TUI signal-driven graceful unmount /
      serve shutdown / print exit-at-run-end).
- [x] Plumb `originDriverId` base → skill-router; ws-handler passes its REMOTE-014 E5
      server-assigned driver id and forwards `ui_intent` (server → client).
- [x] TC-03 RED first: WS e2e proving effects are dropped today (recorded in Evidence Log), then green.
- [x] TC-10 RED first: `/rename` does not persist without the TUI handler (recorded), then green
      via host-side execution — TUI untouched.
- [x] No double execution: adapter call counts asserted (hot-swap, rename, settings ops).

## Stage C — TUI to pure renderer (`agent-transport-tui`) → TC-04 (NOT this branch)

- [ ] Swap TUI subscription legacy effects → `ui_intent` for the four screens AND delete legacy
      branches in the SAME PR (dual-carry ends).
- [ ] Delete `applyLanguageEffect`/`applySettingsResetEffect`, the `cliAdapter` write path, the
      `renameSession` mutation (TC-10 proof precedes), the statusline self-write
      (refresh-on-result replaces it), and dead `applyCommandEffects`/`CommandEffectQueue` branches.

## Stage D — remote surfaces (`agent-transport-gui`, `agent-transport`) → TC-05, TC-09 (NOT this branch)

- [ ] GUI renders supported intents; explicit "not available on this surface" notice otherwise.
- [ ] Headless/programmatic host-action parity docs + tests.
- [ ] WS e2e for the multi-surface exit/restart policy (TC-09).

## Stage E — source migration + deletion (`agent-command` + contract cleanup) → TC-06, TC-07, TC-08 (NOT this branch)

- [ ] Commands emit `hostActions`/`uiIntents` directly; remove the Stage-B shim, `TCommandEffect`,
      `ICommandResult.effects`, all `*-tui-requested` names.
- [ ] Final carriers: `session-renamed` + `conversation-history-cleared` → broadcast session
      events; `session-execution-started` → `result.data`.
- [ ] Grep floor green (TC-06); workspace typecheck (TC-07); harness scan (TC-08).

## Test Plan / 검증

Stages A+B (this branch): `pnpm --filter @robota-sdk/agent-interface-transport build && npx vitest run`
(type test TC-01); `pnpm --filter @robota-sdk/agent-framework build && npx vitest run` (TC-02 host
executor: stub adapters, stripping, `ui_intent` stamping, headless parity, adapter-absent explicit
failure, single-execution assertions); TC-03 WS e2e in `agent-cli` with the pre-Stage-B RED run
recorded in the spec Evidence Log; TC-10 red-first `/rename` persistence proof in `agent-command`;
`pnpm -w typecheck`; `node scripts/harness/run-all-scans.mjs`; and
`pnpm build:deps && pnpm --filter @robota-sdk/agent-transport-tui test` to prove the untouched TUI
stays green (dual-carry + optional-param compatibility). Stages C/D/E carry their own TC rows
(TC-04/05/06/08/09) per the spec Test Plan.
