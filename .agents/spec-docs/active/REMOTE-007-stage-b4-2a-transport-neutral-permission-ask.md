---
status: in-progress
type: INFRA
tags: [remote-control, transport, permissions, interaction]
parent: REMOTE-001
---

# REMOTE-007: Stage B4-2a — transport-neutral permission + ask flow

Parent: [REMOTE-001](../todo/REMOTE-001-webrtc-p2p-remote-control-design.md) (ENDORSED). Prior sub-stages done:
REMOTE-002/003/004/005/006. Under the owner principle **local == remote** (REMOTE-006), whoever drives a session
— local operator or a paired remote — is the session owner and must be able to **answer their own permission
prompts + "ask the user" requests**. This item makes that flow **transport-neutral**. It is the **hard
precondition** REMOTE-006 recorded for the WebRTC enable path (REMOTE-008/B4-2b): an allow-by-default command or a
model tool that needs approval must never execute with **no owner present to approve it**.

Universal + neutral (not remote-specific): it equally closes a **confirmed existing gap** — a session driven over
the WebSocket transport (incl. `agent-web-ui`) today has **nowhere to send a permission/ask prompt** (works only
under `bypassPermissions`). No user-facing enable path here.

## Problem (grounded)

The permission-approval and "ask the user" seams are **pure request/response callbacks injected at session
construction**, with **no event representation**:

- `TPermissionHandler = (toolName, toolArgs) => Promise<TPermissionResult>` (`permission-types.ts:18-27`;
  contract mirror `session-contracts.ts:133-136`). Invoked inside `PermissionEnforcer.checkPermission`
  (`permission-enforcer.ts:201-242`) for `'approve'` decisions (`default`/`acceptEdits` modes → Bash/Write/Edit,
  unknown tools; `permission-mode.ts` MODE_POLICY). **No handler ⇒ deny-by-default** (`:241`).
- `IUserInteraction.ask(request: IActionRequest): Promise<TActionResponse>` (`interaction.ts:74-76`) — invoked by
  commands (`host-context.ts:134`) and model tools (`tool-execution-service.ts:60,218`). `IActionRequest`/
  `TActionResponse` are **pure, function-free, serialization-ready** shapes (`interaction.ts:33-76`).
- The TUI supplies both as **local** handlers backed by Ink UI (`TuiInteractionChannel.ts:169-170`; queues at
  `:348-378,430-477`; rendered by `App.tsx:525-530`). That is what makes them local-TTY-only.
- The **ws-protocol carries NEITHER** — `TServerMessage`/`TClientMessage` (`ws-protocol.ts:22-78`) have no
  permission/ask message, and `createWsHandler` subscribes to no such event (`ws-handler.ts:61-105`) — because
  **there is no event to subscribe to** (`IInteractiveSessionEvents`, `session-contracts.ts:147-170`, has none).
  The WS layer injects no handler (`ws-transport-configurable.ts:105`), so a WS-driven prompt hits whatever the
  underlying session was built with (local TTY, or deny-by-default).

So the callback is inherently single-surface. Making it transport-neutral requires turning it into a
**multi-surface event + resolve** model.

## Solution (sub-sequenced, each commit green)

1. **Add a session-level pending-prompt event + resolve API (SSOT in `agent-interface-transport`).** The session
   gains events `permission_request` (`{ id, toolName, toolArgs }`), `ask_request` (`{ id, request: IActionRequest }`),
   and `prompt_resolved` (`{ id }`) (so a second surface dismisses a prompt the first already answered), plus
   methods `resolvePermission(id, TPermissionResult)` / `resolveAsk(id, TActionResponse)`.
   - **The default handlers replace `askHandler`/`permissionHandler` AT THEIR SOURCE** (the framework builds them,
     bound to the session emitter), so BOTH ask seams are fed from one value: the command port via
     `getUserInteraction()`→`createUserInteractionPort` (`interactive-session.ts:469-471` — its model-invocation
     `cancelled` guard is preserved by construction) AND the tool seam via `ToolExecutionService.setAskHandler`.
     They mint an `id`, emit the event, and **park** the promise in an id-keyed registry; the first `resolve*(id)`
     settles it, deletes the entry, and emits `prompt_resolved`; a late resolve for a settled id is a no-op.
   - **The command-port PRESENCE signal is preserved (D4a).** `getUserInteraction()` MUST still return `undefined`
     when no interactive surface can answer — `getUserInteraction() === undefined` is a load-bearing signal that
     headless/automation commands branch on ("no human ⇒ proceed": `/exit` exits, `/clear` clears —
     `HeadlessInteractionChannel.ts:95`, `host-context.ts:130-134`). An always-defined default port whose `ask()`
     resolves `cancelled` would silently invert that: `exit-command.ts` → "Exit cancelled.", `session-command.ts`
     (`/clear`) → "Clear cancelled." So `getUserInteraction()` is **gated on the `ask_request` listener count**
     (reusing D2's per-event counter): `this.listeners.get('ask_request')?.size` ? `createUserInteractionPort(default, …)` :
     `undefined`, evaluated **per call** (the port is already reconstructed each call at `:469-471`, so it reflects
     current subscribers: headless = 0 listeners → `undefined` → commands proceed; a subscribed TUI/WS surface →
     defined). This is orthogonal to the **tool** `setAskHandler` seam, where an always-present default resolving
     `cancelled` on zero listeners is correct and stays.
   - **Fail-closed rule (D2) — concrete + non-racy.** A parked prompt must be GUARANTEED to settle:
     - **at emit:** if the gating event has **zero listeners** (`permission_request` for permissions,
       `ask_request` for asks — the custom emitter counts per-event, `listeners.get(event)?.size`), resolve
       **deny / `cancelled`** immediately (today's deny-by-default);
     - **on detach:** when a surface unsubscribes (`session.off`), **reconcile** — any still-parked prompt whose
       gating event dropped to zero listeners resolves deny/cancel (so a WS disconnect mid-prompt cannot hang it);
     - a **bounded backstop timeout** is an unconditional last resort (never fires while a live surface still holds
       the prompt open for a human).
   - **Teardown drain (D3) — behavior-preserving.** On `abort` / `cancelQueue` / shutdown, the framework **drains
     the registry** — deny all parked permissions, cancel all parked asks — reproducing the TUI's current
     `cancelAllPermissions` / `cancelAllUserActions` (`TuiInteractionChannel.ts:381-390,468-477`). Without this an
     aborted turn leaves `PermissionEnforcer.checkPermission`'s `await` (and the wrapped tool) hanging forever.
2. **Migrate BOTH injected-handler sites to subscribe + resolve (behavior-preserving).** `TuiInteractionChannel`
   (`:169-170`) AND the programmatic channel's `createInteractiveRuntime.ts:137` (`askHandler: channel.askUser`)
   stop injecting their own callbacks; the framework's event-emitting default is the sole handler source, and each
   surface (TUI now, WS next) subscribes to `permission_request`/`ask_request`, drives its prompt, answers via
   `resolvePermission`/`resolveAsk`, and dismisses on `prompt_resolved`. Local Ink UX is unchanged (the TUI's
   existing `permissionQueue`/`userActionQueue` become event-driven; teardown semantics move into the framework
   drain, D3).
3. **Carry it over the protocol.** Add to `ws-protocol.ts`: server→client `permission_request` / `ask_request` /
   `prompt_resolved`; client→session `permission_response` (`{ id, result: TPermissionResult }`) / `ask_response`
   (`{ id, response: TActionResponse }`). `createWsHandler` **subscribes** to the new events and forwards them, and
   handles the two response verbs by calling `session.resolvePermission`/`resolveAsk`. Now a WS (and WebRTC) driver
   receives the prompt and answers it; co-drive = first surface to answer wins, others dismiss on `prompt_resolved`.
4. **NO enable path; residual stated honestly (D4).** WebRTC transport stays unregistered + pairing-gated; no
   `/remote-control`. This item closes the gap at the **transport mechanism** level (TC-06: the protocol carries the
   prompt and a Node/integration client answers it) and — because `agent-transport-webrtc` reuses the same
   `createWsHandler` — gives the WebRTC path the capability for free. The **human-facing `agent-web-ui`** user still
   cannot answer a prompt until the deferred web-UI render+answer follow-up; that follow-up (not this item) closes
   the web human gap. REMOTE-008 (the enable path) consumes this layer.

## Affected Files

- `packages/agent-interface-transport/src/session-contracts.ts` (events + `resolvePermission`/`resolveAsk` on `IInteractiveSession`; `IInteractiveSessionEvents`) — SSOT
- `packages/agent-framework/src/interactive/**` (default event-emitting permission/ask handlers built at the session; id-keyed parked-promise registry; fail-closed emit/detach reconcile + backstop; **teardown drain** on abort/cancelQueue/shutdown; the resolve methods)
- `packages/agent-framework/src/interaction/createInteractiveRuntime.ts` (the 2nd `askHandler` injector — migrate to the event default) + `user-interaction-port.ts` (model-guard preserved) + `interactive-session.ts` `getUserInteraction()` (gate the returned port on the `ask_request` listener count — D4a, preserves the headless `undefined` contract)
- `packages/agent-command/src/exit/exit-command.ts`, `packages/agent-command/src/session/session-command.ts`, `packages/agent-command/src/mode/mode-command.ts` — **unchanged**; their `getUserInteraction()`-absence branch is what D4a protects (regression-guarded by TC-04c)
- `packages/agent-transport/src/headless/HeadlessInteractionChannel.ts:94-96` — the "no-human ⇒ proceed" contract this migration must not break (asserted by TC-04c); **refresh its comment** in Step 2 (post-D4a the `undefined` comes from the zero-listener gate, not from a missing injected handler)
- `packages/agent-transport-tui/src/TuiInteractionChannel.ts` (+ `App.tsx` unchanged) — subscribe+resolve instead of injected callbacks; teardown deferred to the framework drain
- `packages/agent-transport-protocol/src/ws-protocol.ts` (new messages) + `ws-handler.ts` (forward events + handle responses) + `docs/SPEC.md`
- `packages/agent-web-ui/**` (deferred follow-up: consume the new messages to render+answer)
- changeset

## Completion Criteria

- [ ] TC-01: a `'approve'` tool call on a session with a subscribed surface emits `permission_request` (id + payload);
      `resolvePermission(id, true)` lets the tool run; `resolvePermission(id, false)` denies — asserted.
- [ ] TC-02: `ask_request` is emitted for a command/tool `ask`; `resolveAsk(id, {type:'answer',...})` returns that
      response to the caller; `{type:'cancelled'}` cancels.
- [ ] TC-03: **fail-closed at emit** — with NO surface subscribed to the gating event, a `'approve'` tool is DENIED
      and an `ask` resolves `cancelled` immediately (preserves today's deny-by-default).
- [ ] TC-03b: **reconcile-on-detach** — a surface subscribes, a prompt parks (pending), the surface unsubscribes
      (`session.off`) dropping the gating event to zero listeners → the parked prompt resolves deny/cancel (a WS
      disconnect mid-prompt cannot hang the awaiting tool).
- [ ] TC-03c: **teardown drain** — `abort`/`cancelQueue`/shutdown with parked prompts denies all parked permissions + cancels all parked asks; the awaiting `checkPermission`/tool settles (no hang) — reproduces the TUI's
      current cancel-all semantics.
- [ ] TC-04: **co-drive dismiss** — two subscribed surfaces both receive `permission_request`; the first
      `resolvePermission` wins and a `prompt_resolved` fires so the other dismisses; a late resolve for the same id
      is a no-op.
- [ ] TC-04b: **both ask seams fed + model-guard preserved** — a command-port `ask` and a tool `ask` both emit
      `ask_request`; a model-invoked command's `ask` still resolves `cancelled` (the `createUserInteractionPort`
      guard is not dropped by the migration).
- [ ] TC-04c: **headless presence contract preserved (D4a)** — with NO surface subscribed to `ask_request`,
      `getUserInteraction()` returns `undefined`, so headless `/exit` still **exits** (not "Exit cancelled.") and
      `/clear` still **clears** (not "Clear cancelled."), and `/mode` still reports current — the
      `HeadlessInteractionChannel.ts:94-96` "no-human ⇒ proceed" contract survives the event-default migration.
      (These three are representative — the gate is command-agnostic, so every `getUserInteraction?.()`-absence caller,
      e.g. `preset`/`language`/`provider`, is protected by the same zero-listener → `undefined` guarantee.)
- [ ] TC-05: **TUI behavior-preserving** — the local Ink permission/ask prompts still appear + answer (existing TUI
      suites green; the migration changes wiring, not UX).
- [ ] TC-06: **end-to-end over WS** — drive a session through `createWsHandler`, trigger a `'approve'` tool, receive
      the `permission_request` server message over the wire, send `permission_response`, and observe the tool run
      (the confirmed gap is closed). Same for `ask`.
- [ ] TC-07: **NO enable path** — WebRTC unregistered, no `/remote-control` (grep-asserted).
- [ ] TC-08: `pnpm harness:scan` (+ spec-public-surface for the new session/protocol surface) + affected suites
      (agent-framework, agent-session, agent-transport-protocol, agent-transport-tui, agent-interface-transport,
      agent-cli) + full-repo `pnpm typecheck` 0; changeset present.

## Test Plan

RED→GREEN. Unit-test the parked-promise registry + fail-closed timeout with a stub session. TUI migration rides its
existing prompt suites. The protocol round-trip is a `createWsHandler` integration test (stub session emits the
event → assert the server message → send the response verb → assert `resolve*` called + the awaiting promise
settles). harness `spec-public-surface`/`interface-imports` green; changeset.

## Decisions (resolved at GATE-APPROVAL round 1)

- **D1 — event + `resolve*(id)` model** (ENDORSED): a session-level `permission_request`/`ask_request`/
  `prompt_resolved` event + `resolvePermission`/`resolveAsk`, over a registration broker — inherently
  multi-surface + consistent with how `createWsHandler` already fans out every session event.
- **D2 — fail-closed is guaranteed-settle, non-racy:** deny/cancel at emit when the gating event has zero
  listeners; **reconcile-on-detach** (a parked prompt whose gating event drops to zero listeners resolves
  deny/cancel); plus a bounded backstop timeout. Per-event listener-count gate (`permission_request` for
  permissions, `ask_request` for asks); each surface subscribes to both.
- **D3 — teardown drain:** abort/cancelQueue/shutdown deny all parked permissions + cancel all parked asks
  (reproduces the TUI's `cancelAllPermissions`/`cancelAllUserActions`) — else an aborted turn hangs the tool.
- **D4 — the event-emitting default replaces `askHandler`/`permissionHandler` at their SOURCE**, feeding both the
  command port (model-guard preserved) and the tool `setAskHandler` seam; **both** injector sites migrate (TUI +
  `createInteractiveRuntime.ts`). agent-web-ui render+answer is a **deferred follow-up** (residual stated).
- **D4a — command-port presence is preserved (round-2 amendment).** The always-present event default must NOT make
  `getUserInteraction()` always-defined: that would invert the load-bearing headless `undefined` contract and turn
  `/exit`→"Exit cancelled.", `/clear`→"Clear cancelled.". `getUserInteraction()` is gated on the `ask_request`
  listener count (reusing D2's per-event counter, evaluated per call): 0 listeners → `undefined` (headless commands
  proceed), a subscribed surface → defined. Orthogonal to the **tool** `setAskHandler` seam, which stays always-present
  and resolves `cancelled` on zero listeners. Regression-guarded by TC-04c.

## Open Questions (for GATE-APPROVAL)

None — resolved into D1–D4. (Backstop-timeout concrete value is an implementation detail, tunable.)

## Tasks

- [ ] Step 1 — session events (`permission_request`/`ask_request`/`prompt_resolved`) + `resolvePermission`/`resolveAsk` + the id-keyed parked-promise registry + event-emitting default handlers (replacing askHandler/permissionHandler at source) + fail-closed (emit-zero-listener + reconcile-on-detach + backstop) + teardown drain (SSOT in agent-interface-transport, impl in agent-framework).
- [ ] Step 2 — migrate BOTH injector sites (`TuiInteractionChannel` + `createInteractiveRuntime.ts`) to subscribe + resolve (behavior-preserving; model-guard preserved); gate `getUserInteraction()` on the `ask_request` listener count so the headless `undefined` presence contract survives (D4a).
- [ ] Step 3 — ws-protocol messages + `createWsHandler` forward events + handle response verbs; SPEC update.
- [ ] Step 4 — tests (registry, fail-closed emit/detach, teardown drain, co-drive dismiss, both-ask-seams+model-guard, TUI regression, WS end-to-end round-trip, no-enable-path) + changeset.
- [ ] Step 5 — verify: harness:scan + typecheck + changeset.

## Evidence Log

- 2026-07-11 GATE-DRAFT — authored from the REMOTE-006 precondition + an Explore of the permission/ask flow.
  Grounding verified: permission + ask are pure injected request/response callbacks (`TPermissionHandler`,
  `IUserInteraction.ask`) with **no** session event; the TUI wires them to local Ink UI; the ws-protocol carries
  **neither** and `createWsHandler` subscribes to no such event; a WS-driven (incl. `agent-web-ui`) prompt has
  nowhere to go today (deny-by-default / bypass-only). Proposes an event + `resolve*(id)` multi-surface model.
  Pending proposal-reviewer ENDORSE.
- 2026-07-11 GATE-APPROVAL round 1 — proposal-reviewer **REVISE** (the event + `resolve*(id)` model ENDORSED over a
  broker; layering right — SSOT in agent-interface-transport, impl in agent-framework, protocol auto-shared with
  WebRTC via `createWsHandler`; enforcer unchanged since it just awaits `Promise<TPermissionResult>`; the emitter
  field is live before the enforcer is built, so no emit-before-exists hazard; `IActionRequest.id` was already
  authored for first-answer-wins). Four correctness amendments folded in: **D3** teardown drain
  (abort/cancelQueue/shutdown must deny/cancel parked prompts, else an aborted turn hangs the tool); **D2** a
  non-racy fail-closed rule (deny at emit on zero listeners + reconcile-on-detach + backstop timeout; per-event
  listener gate); **D4** the event default must replace the handler AT SOURCE to feed both ask seams (command port +
  `setAskHandler`) and the **second** injector `createInteractiveRuntime.ts:137` must migrate too, preserving the
  `createUserInteractionPort` model-guard; and the **web-UI human residual** stated honestly (deferred follow-up).
  TCs added (TC-03b detach, TC-03c teardown, TC-04b both-seams+guard). Re-review → round 2.
- 2026-07-11 GATE-APPROVAL round 2 — proposal-reviewer **REVISE**. Verified D1/D2/D3 + residual are code-accurate
  (drain hooks exist: `abort` `interactive-session.ts:379`, `cancelQueue` `interactive-session-base.ts:94`, `shutdown`
  `:384`; emitter is a per-event-countable `Map<string,Set>` `:77,314-329`; both ask seams fed from `options.askHandler`
  — command port `:116,470` + tool `interactive-session-init.ts:136`→`robota-initializer.ts:129`; REMOTE-008 buildable
  since `webrtc-transport.ts:99` reuses `createWsHandler` and `subscribeSessionEvents` `ws-handler.ts:61-105` is an
  explicit per-event list Step 3 extends). **One blocking defect the amendment introduced:** making the event default
  the sole, unconditionally-present ask handler makes `getUserInteraction()` always-defined, silently inverting the
  headless `undefined` contract — `exit-command.ts:13-19`→"Exit cancelled.", `session-command.ts:28-33` (`/clear`)→
  "Clear cancelled." (`/mode` converges by luck). Fixed via **D4a**: gate the command port on the `ask_request`
  listener count (reuses D2's counter, per-call), keep the tool seam always-present; added **TC-04c** (headless
  `/exit`/`/clear` proceed, `/mode` reports current). Re-review → round 3.
- 2026-07-11 GATE-APPROVAL round 3 — proposal-reviewer **ENDORSE**. D4a verified code-accurate + complete against the
  source: `getUserInteraction()` reconstructs the port per call (`interactive-session.ts:469-471`, no memoization);
  `createUserInteractionPort` returns `undefined` iff handler falsy (`user-interaction-port.ts:23`) so the
  zero-listener gate restores today's `undefined` exactly; the three headless branches match TC-04c
  (`exit-command.ts:13-19` exit, `session-command.ts:28-33` clear, `mode-command.ts:19-42` report-current); the gate
  is orthogonal to the tool `setAskHandler` seam (fed via `interactive-session-init.ts:136`→`robota-initializer.ts:129`,
  no hang/regression); no new Solution↔Decisions↔TC↔Files↔Tasks inconsistency. Two non-blocking polish notes folded in:
  refresh the `HeadlessInteractionChannel.ts:94-96` comment in Step 2 (post-D4a the `undefined` comes from the gate,
  not a missing handler) + TC-04c's three commands are representative of a command-agnostic guarantee. **GATE-APPROVAL
  cleared** → status in-progress, spec moved to active, implementation begins on an `origin/develop`-based branch.
