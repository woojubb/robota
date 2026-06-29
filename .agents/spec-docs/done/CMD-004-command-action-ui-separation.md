---
status: done
type: FLOW
tags: [cli, typescript, websocket, async]
---

# CMD-004: Separate interaction ACTION from UI — one UI-agnostic action seam for every source

> Formal gate-pipeline spec for the lightweight backlog item
> [`.agents/backlog/CMD-004-command-action-ui-separation.md`](../../backlog/CMD-004-command-action-ui-separation.md).
> CMD-005 (model-invocable question tool) depends on this foundation.
>
> **Revision note:** v2 after a 3-perspective architecture review. v1 had two invalidating defects —
> the ask-port layer made CMD-005 unreachable (W1) and the single action shape silently dropped
> `masked`/`validate` (W2, an API-key plaintext regression). Both are corrected below, plus four
> refinements (TUI renderer is net-new; additive-then-delete PR decomposition; first-wins concurrency
> made safe via idempotent resolve; ask injected as a narrow port, not on the god-context).

## Problem

"Asking the user" is implemented as **two parallel, mutually-exclusive systems** that each couple the
interaction to a specific driver/UI, and neither lets the agent (model) ask at all:

1. **Path A — `requestAction` / `TActionRequest`** (`interaction-contracts.ts:34-41`): kinds `pick`
   (single, no free-text) and `confirm`. Driven only by **command `interactionHints`** in
   `createInteractiveRuntime.handleSubmit` (`createInteractiveRuntime.ts:150`), used by the
   **programmatic** and **headless** channels. The TUI does **not** use this runtime — and crucially the
   TUI's own `requestAction`/`pendingAction` queue (`TuiInteractionChannel.ts:192-197, 282-291`) is
   **rendered nowhere** (`pendingAction` has zero consumers in `App.tsx`/hooks): Path A is dead in the TUI.
2. **Path B — `ICommandResult.interaction` / `TCommandInteractionPrompt`** (`command-contracts.ts:106-135`):
   kinds `choice` and `text`, a **stateful continuation** (`submit()` returns another `ICommandResult`,
   i.e. a multi-step wizard). Rendered **only by the TUI** (`useSideEffects.ts:77-150` →
   `InteractivePrompt.tsx:18-59`). The provider command wizard is the dominant user (13 sites, all in
   `agent-command/src/provider/*`) and relies on `masked` (API-key entry), `validate`, `placeholder`,
   `allowEmpty`, `maxVisible`.

Consequences (reproduced by reading the code paths above):

- The same `InteractiveSession` can be attached by **multiple environments at once** (a remote web
  client and a local terminal — `transport-registry.ts:18-91`), but the WS transport is **output-only**:
  `TServerMessage`/`TClientMessage` (`ws-protocol.ts:22-78`) carry **no** action/dialog message, so the
  web client **cannot answer** an interaction. Coupling the action to the TUI renderer breaks the moment
  a second environment attaches.
- The action contract is **too narrow**: no multi-select, no "choose an option **or** type your own".
- The **agent (model) cannot issue an interaction at all** — only slash-command paths can (CMD-005 needs
  this seam, and it needs it reachable from tool execution, not just command execution).
- Three disconnected user-prompt seams already exist (`permissionHandler` deep in tool execution,
  `requestAction` at the runtime, `ICommandPickerAdapter.pick`) plus a dead `IPermissionRequest` event —
  every new interaction is built more than once and is silently TUI-only or programmatic-only.

## Architecture Review

### Affected Scope

- `packages/agent-core` — **SSOT for the action data contract + the ask port** (`IActionOption`,
  `IActionRequest`, `TActionResponse`, `IUserInteraction`). Placed here (not in
  `agent-interface-transport`) because both command execution (`ICommandHostContext`, agent-framework)
  AND tool execution (`IToolExecutionContext`, agent-core) must reach it; `agent-tools` depends only on
  `agent-core`. Pure types — preserves agent-core zero-dependency.
- `packages/agent-interface-transport` — `IInteractionChannel.requestAction` re-typed to the core
  contract; remove `IPickItem`, old `TActionRequest`, `TCommandInteractionHint`, `ICommandInteraction`,
  `TCommandInteractionPrompt`, `ICommandChoicePromptOption`, `ICommandResult.interaction`, and the dead
  `IPermissionRequest` event variants.
- `packages/agent-framework` — ask-port wiring: inject `askHandler` into `InteractiveSession` (sibling to
  `permissionHandler`); expose `ask` to commands as a **narrow capability port** (per REFACTOR-006, not on
  the base `ICommandHostContext`); rewrite `createInteractiveRuntime` routing; remove `interactionHints`
  plumbing. Gate `ask` to decline under `invocationSource === 'model'` (executing-turn deadlock guard).
- `packages/agent-command` — migrate 6 Path-A `interactionHints` commands (mode, preset, provider,
  language, exit, clear) and 13 Path-B wizard sites (`provider/*`) to inline `await context.ask(...)`,
  with content validation as a **re-ask loop** (not a contract closure).
- `packages/agent-transport-tui` — **build** the `pendingAction` Ink renderer (net-new: the queue renders
  nothing today) for the unified action incl. multi-select and `masked`; wire abort → resolve-cancelled
  and input-gating while a request is pending; delete Path-B rendering + dead `CommandPicker`/`CommandConfirm`.
- `packages/agent-transport` — programmatic + headless channel adapters answer the unified action
  (headless = explicit `cancelled`/policy, never a silent guess).
- `packages/agent-transport-ws` (Phase 2) — protocol gains serializable `action_request`/`action_response`.
- `packages/agent-web-ui` (Phase 2) — web modal adapter; multi-env broadcast in the ask port.

### Alternatives Considered

1. **Keep both paths, only widen each.**
   - Pro: smallest diff.
   - Con: preserves the dual-contract / TUI-coupling defect; agent still cannot ask; web still cannot
     answer. Rejected — does not solve the problem.
2. **Unify into a 4-variant discriminated union** (`confirm`/`select`/`multiSelect`/`text`).
   - Pro: single render path.
   - Con: the 4 "variants" are configurations of one primitive (`confirm` = 2-option single-select,
     `text` = no-option free-text); a 4-way switch is redundant. Rejected after review (user-confirmed).
3. **Single `IActionRequest` primitive + injected ask port, port SSOT in `agent-interface-transport`
   (v1 chosen, now rejected).**
   - Con: `agent-tools` cannot see `agent-interface-transport`, so the model-tool source (CMD-005) can
     never reach the port — the central forward-compat claim is false. Rejected on layering evidence.
4. **Single `IActionRequest` primitive + injected ask port, SSOT in `agent-core`, serializable field set
   incl. `masked`/`placeholder`/`allowEmpty`, content validation via re-ask loop (chosen).** One object
   shape (`options` × `minSelect`/`maxSelect` × `allowFreeText` × `masked`) covers
   confirm/single/multi/text/secret. Issuance is an injected port reachable by **every source** —
   command host context now, tool execution context for CMD-005 — and rendered per-environment.
   - Pro: one contract at the right layer; one render path driven by fields; one seam for all sources;
     WS-serializable (no closures in the contract); the natural home for multi-env concurrency.
   - Con: `confirm` loses its bare boolean (absorbed by `isConfirmed()`); stateful validation becomes a
     re-ask loop instead of an in-dialog closure (a minor UX change: the dialog reopens with the error);
     large migration (19 call sites + channels + a net-new TUI renderer + tests). Accepted — pre-release,
     no backward-compat constraint; correctness over churn (`code-quality.md` design-first rule).

### Decision

Adopt Alternative 4. Three layers — **Source → Action → UI**:

```
Source (who triggers the ask)        Action (UI-agnostic, agent-core)   UI (per environment)
─────────────────────────────        ───────────────────────────────   ────────────────────
• command host context (now)    →                                  →    TUI Ink dialog
• tool execution context             IActionRequest                 →   web modal (Phase 2)
  (CMD-005, later)              →     via IUserInteraction.ask      →    programmatic / headless answer
```

`IUserInteraction` (the ask port) owns multi-environment concurrency; each
`IInteractionChannel.requestAction` renders one environment's UI. The `permissionHandler` option on
`InteractiveSession` is the proven injection template — `askHandler` is wired identically at every
session-creation site (TUI channel, headless channel, programmatic driver, `createInteractiveRuntime`),
each supplying its channel's `requestAction`. Placing the contract + port in `agent-core` is what makes
the **tool** source (CMD-005) reachable without a later breaking move.

**Concurrency (decided):** broadcast to all attached interactive channels, **first answer wins**, made
safe by **idempotent resolve** — the ask port holds one in-flight request per `id`; the first
`TActionResponse` resolves it; any later response for an already-resolved `id` is **ignored as stale**
and the other channels are dismissed. (User decision: keep first-wins; stale/expired answers are
validated out.)

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — interaction sources surveyed: command `interactionHints` (6), command
      `ICommandResult.interaction` wizards (13, all `provider/*`), `permissionHandler` (deep tool-exec
      injection precedent), and `ICommandPickerAdapter.pick`; tool-execution source validated against
      `agent-tools → agent-core` layering (drove the agent-core placement); model-tool source deferred to CMD-005.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

### Unified action contract (SSOT: `agent-core`)

```ts
export interface IActionOption {
  value: string;
  label: string;
  description?: string;
}

/** One request for the user to answer — confirm/single/multi/free-text/secret in one shape. */
export interface IActionRequest {
  id: string; // correlation key; the ask port resolves a given id exactly once (idempotent)
  title: string;
  description?: string;
  /** Predefined options. Empty/omitted ⇒ pure free-text entry. */
  options?: readonly IActionOption[];
  /** Minimum selections required (default 1). */
  minSelect?: number;
  /** Maximum selections allowed (default 1 ⇒ single; >1 ⇒ multi). */
  maxSelect?: number;
  /** Allow a typed custom answer in addition to / instead of options. */
  allowFreeText?: boolean;
  /** Free-text entry is masked (secret entry, e.g. API key). Serializable — renderer masks. */
  masked?: boolean;
  /** Allow submitting empty free text. */
  allowEmpty?: boolean;
  /** Placeholder for the free-text field. */
  placeholder?: string;
  /** Max options shown before scrolling (renderer hint). */
  maxVisible?: number;
  /** Pre-selected option values and/or prefilled text. */
  default?: { values?: readonly string[]; text?: string };
}

export type TActionResponse =
  | { type: 'answer'; values: readonly string[]; text?: string }
  | { type: 'cancelled' };

/** The injected "ask the user" port — reachable by command and tool execution contexts. */
export interface IUserInteraction {
  ask(request: IActionRequest): Promise<TActionResponse>;
}
```

No function-valued fields → the contract crosses the Phase-2 WS boundary unchanged. **Stateful
validation** (e.g. "profile name must be unique") is NOT a contract closure: the command receives the
answer, validates against its own state, and on failure calls `ask` again with the error in
`description` (re-ask loop) — naturally multi-step and serialization-safe.

Ergonomic constructors + helper keep call sites readable (contract stays single): `confirmAction(id,
message)`, `selectAction(id, title, options, opts?)`, `multiSelectAction(...)`, `textAction(id, title,
{ masked?, ... })`, and `isConfirmed(response)`.

### The ask port (`IUserInteraction`) — injection & reach

- Injected into `InteractiveSession` via a new `askHandler?: IUserInteraction['ask']` option (parallel to
  `permissionHandler`), threaded the same route.
- Exposed to **commands** as a narrow capability port (REFACTOR-006 pattern), not added to the base
  `ICommandHostContext`. Commands that ask declare the dependency explicitly.
- Exposed to **tools** (CMD-005) via `IToolExecutionContext` in `agent-core` — same port type, same
  injected handler. (CMD-004 only makes it reachable; the turn-suspension mechanics for a model-issued
  ask are CMD-005's design.)
- **Model-invocation guard (Phase 1):** a command invoked by the model runs inside an executing turn
  (`executing === true`); an inline `ask` there would deadlock. When `invocationSource === 'model'`, the
  port resolves `{ type: 'cancelled' }` (no human at a prompt) rather than blocking.
- **Phase 1 impl** wraps the single attached channel: `ask → channel.requestAction`, resolving
  `{ type: 'cancelled' }` when no interactive renderer is attached (headless) — consistent with the
  programmatic empty-queue semantics; never a silent guess.
- **Phase 2 impl** broadcasts to all attached interactive channels with first-wins + idempotent resolve.

### Source migration (inline ask)

Commands ask **inline** during `execute`: `const r = await context.ask(selectAction(...)); if (r.type
=== 'cancelled') return ...;`. Path-A commands ask at the top of `execute` (replacing `interactionHints`

- `buildActionRequest`/`resolveArgsFromResponse`, which are deleted). Path-B wizards become sequential
  `await context.ask()` calls (replacing the returned continuation); `ICommandResult.interaction` and its
  TUI rendering are deleted. `masked` carries API-key entry; duplicate-name validation becomes a re-ask.

### Per-transport rendering (net-new in the TUI)

- **TUI**: build the `pendingAction` Ink renderer (the existing queue renders nothing today) — single
  list, multi-select checklist, confirm as a 2-option list, masked text field — all derived from
  `IActionRequest` fields. Wire it like the existing `pendingInteractionPrompt` (`App.tsx:447-453`):
  resolve via the channel's `resolveAction`; **abort** (Ctrl-C / cancelQueue) resolves the in-flight
  action as `{ cancelled }`; **input is gated** while `pendingAction !== null`. Delete the Path-B
  `InteractivePrompt`/`useSideEffects` interaction path and the dead pickers.
- **programmatic / headless**: answer the unified action from the pre-supplied queue (or `cancelled`).

### Phasing — additive-then-delete (each PR green + code-reviewed)

- **Phase 1** (this gate's scope), as 4 PRs so every step has a green `typecheck` and a reviewable diff:
  - **PR-A**: add `IActionRequest`/`TActionResponse`/`IUserInteraction` + constructors in `agent-core`
    **alongside** the old contracts (additive).
  - **PR-B**: implement `ask` on the session + channels + the **TUI `pendingAction` renderer**; prove it
    by migrating the 6 simple Path-A commands; add the model-invocation guard.
  - **PR-C**: migrate the 13 provider wizard sites (with `masked` + re-ask validation tests).
  - **PR-D**: delete Path-A `interactionHints`, Path-B `ICommandResult.interaction`, dead pickers, and
    the dead `IPermissionRequest` event.
- **Phase 2** (separate spec/PRs): WS `action_request`/`action_response`; web-ui modal adapter; the ask
  port's broadcast + first-wins + idempotent-resolve across attached interactive channels.

### Out of scope (follow-up backlog)

Consolidating `permissionHandler` and `ICommandPickerAdapter.pick` onto the `ask` seam (they share the
channel surface; the TUI `permissionQueue` duplicates `actionQueue`). CMD-004 makes `ask` the SSOT seam
and does not add a fourth; the adapt-permission-onto-ask migration is its own item.

## Affected Files

- `packages/agent-core/src/**` — new action contract + `IUserInteraction`; add `ask` to
  `IToolExecutionContext`; exports.
- `packages/agent-interface-transport/src/{interaction-contracts.ts,command-contracts.ts,index.ts,__tests__/contracts.test.ts}` — re-type `requestAction`; remove old contracts + dead permission event.
- `packages/agent-framework/src/interaction/{createInteractiveRuntime.ts,types.ts,IInteractionChannel.ts,index.ts}`,
  `command-api/{command-module.ts,host-context.ts,interactions.ts,command-result.ts,index.ts}`,
  `interactive/{interactive-session*.ts,interactive-session-options.ts,interactive-session-skill-router.ts}` — `askHandler` wiring, capability port, model-invocation guard, remove `interactionHints`.
- `packages/agent-command/src/{mode,preset,provider,language,exit,session}/*` — inline `context.ask` + re-ask validation.
- `packages/agent-transport-tui/src/{TuiInteractionChannel.ts,App.tsx,hooks/useSideEffects.ts,hooks/command-effect-queue.ts,hooks/side-effects-types.ts,InteractivePrompt.tsx,interactions/*}` + a new `PendingActionPrompt` renderer — unified render; abort + input-gating; delete Path-B + dead pickers.
- `packages/agent-transport/src/{programmatic/ProgrammaticInteractionChannel.ts,headless/HeadlessInteractionChannel.ts}` — unified answer.
- SPEC updates (same PRs): `agent-core`, `agent-interface-transport`, `agent-framework`, `agent-transport-tui` `docs/SPEC.md`.

## Completion Criteria

Phase 1 scope (Phase 2 tracked separately under this spec):

- [x] TC-01: `pnpm --filter @robota-sdk/agent-core build && pnpm --filter @robota-sdk/agent-core test` → exits 0; a type test asserts `IActionRequest` carries `options/minSelect/maxSelect/allowFreeText/masked/allowEmpty` and `IUserInteraction.ask` is exported from `agent-core`.
- [x] TC-02: `pnpm -w typecheck` → exits 0 in the final state (old contracts removed) — proves every consumer migrated.
- [x] TC-03: `rg -n "interactionHints|ICommandInteraction|TCommandInteractionPrompt|IPickItem|IPermissionRequest|\.interaction\b" packages/*/src` → no production-code matches (docs only).
- [x] TC-04: `pnpm --filter @robota-sdk/agent-command test` → exits 0; tests drive `/mode` (single-select), `/exit` (confirm via `isConfirmed`), and a provider wizard step through a mock `IUserInteraction`, asserting a `masked` API-key request and a re-ask-on-duplicate-name loop.
- [x] TC-05: `pnpm --filter @robota-sdk/agent-transport test` → exits 0; programmatic channel returns `{ type: 'answer', values }` from its queue and `{ type: 'cancelled' }` on empty queue / headless.
- [x] TC-06: `pnpm --filter @robota-sdk/agent-transport-tui test` (incl. PTY) → exits 0; a TUI test renders an `IActionRequest` with `maxSelect>1` (multi-select) and one with `masked:true` (input shown as `*`), submits, and asserts Ctrl-C resolves the in-flight ask as `cancelled` and input is gated while pending.
- [x] TC-07: `pnpm --filter @robota-sdk/agent-framework test` → exits 0; a test asserts that with `invocationSource === 'model'` the ask port resolves `{ type: 'cancelled' }` (no deadlock) and the command returns.
- [x] TC-08: `pnpm harness:scan` → exits 0 (anti-monolith, conformance, conflict-markers green).
- [x] TC-09: User Execution evidence recorded — a real-binary PTY test (`provider-setup.ptytest.ts`) drives `/provider add` on the built CLI; the masked API-key field renders as `*` and never echoes the typed secret, then Esc cancels. Automated per the never-ask-the-user-to-test rule.

## Test Plan

Strategy (FLOW + cli/typescript/websocket/async): TS type test for the contract; whole-workspace
typecheck as migration-completeness proof; unit/integration for command sources via a mock ask port;
PTY for TUI render incl. masked + abort; harness scan for repo gates.

| TC-ID | Test Type        | Tool / Approach                                                | Notes                                                                                                                                                                                             |
| ----- | ---------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | DATA / type      | vitest + tsd-style type test in `agent-core`                   | unified shape incl. `masked`; `IUserInteraction` exported from core                                                                                                                               |
| TC-02 | BEHAVIOR         | `pnpm -w typecheck`                                            | final-state compile = migration completeness                                                                                                                                                      |
| TC-03 | RULE             | `rg` absence check                                             | no dual-contract / dead-event symbols in `packages/*/src`                                                                                                                                         |
| TC-04 | FLOW (cli)       | vitest, mock `IUserInteraction`                                | single-select, confirm, masked API-key, re-ask validation loop                                                                                                                                    |
| TC-05 | BEHAVIOR (async) | vitest                                                         | programmatic answer + cancelled/headless semantics                                                                                                                                                |
| TC-06 | SCREEN (cli)     | vitest + PTY (`*.ptytest.ts`)                                  | multi-select, masked render (`*`), Ctrl-C cancels, input gating                                                                                                                                   |
| TC-07 | RULE             | vitest                                                         | model-invocation ask guard returns cancelled, no deadlock                                                                                                                                         |
| TC-08 | INFRA            | `pnpm harness:scan`                                            | repo mechanical gates                                                                                                                                                                             |
| TC-09 | FLOW (cli)       | vitest + PTY on the built binary (`provider-setup.ptytest.ts`) | `/provider add` on the real CLI renders the masked API-key field as `*` (secret never echoed) then cancels on Esc — User Execution evidence captured automatically rather than by a human session |

## Tasks

- [x] `.agents/tasks/CMD-004.md` — created (GATE-IMPLEMENT). Tasks decomposed into PR-A…PR-D mapped to TC-01…TC-09.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-28

**Status upgrade:** draft → review-ready

- Frontmatter: opens with `---`; `status: draft`; `type: FLOW` (valid 11-prefix value); `tags: [cli, typescript, websocket, async]` present.
- Problem: concrete symptoms with file:line evidence (TUI `pendingAction` rendered nowhere; WS `TServerMessage`/`TClientMessage` carry no action message → web client cannot answer); reproduction stated (when a second environment attaches to the same `InteractiveSession`); no TBD/TODO/vague single-sentence text.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with completion evidence (sources surveyed: 6 `interactionHints`, 13 `provider/*` wizards, `permissionHandler`, `ICommandPickerAdapter.pick`; tool-exec layering validated).
- Alternatives Considered: 4 entries (≥2), each with pro/con.
- Decision: references the driving trade-off (correctness over churn, agent-core placement makes the tool source reachable without a later breaking move).
- Completion Criteria: every item TC-N prefixed (TC-01..TC-09); each in command/observable form; no banned vague language ("works correctly"/"no errors"/"implemented"/"displays correctly").
- Test Plan: `## Test Plan` present; one row per TC-N (TC-01..TC-09); each row has non-empty Test Type + Tool; manual row TC-09 carries a Notes justification (real-terminal render correctness not fully assertable headlessly).
- Structure: `## Tasks` present with placeholder; `## Evidence Log` present and empty prior to this entry; no `## Status` or `## Classification` body sections.
- TC-N count match: Completion Criteria = 9, Test Plan = 9 (9 = 9).

### [GATE-APPROVAL] — ✅ PASS | 2026-06-28

**Status upgrade:** review-ready → approved

- Prior gate: GATE-WRITE ✅ PASS above; input status `review-ready` (backlog/) matches the expected stage.
- User explicit approval (verbatim): "2부터 하고 1도 바로 이어서 작업해" — answering the two-item prompt where item 1 was "approve Phase 1 implementation start (PR-A onward)"; the directive to execute item 1 authorizes implementation of this spec.
- No Architecture Review, frontmatter `type`, or `tags` modified after approval.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-28

**Status upgrade:** approved → in-progress

- Prior gate: GATE-APPROVAL ✅ PASS above; input status `approved` (todo/) matches the expected stage.
- Tasks file created: `.agents/tasks/CMD-004.md`, recorded in the `## Tasks` section.
- Tasks correspond to Completion Criteria: PR-A→TC-01; PR-B→TC-05/06/07 + TC-04(part); PR-C→TC-04(masked/re-ask); PR-D→TC-02/03; final TC-08/TC-09 — ≥1 task per TC-N.
- Tasks file includes a `## Test Plan / 검증` section (>50 chars) — satisfies the `test-plans` harness scan [AF-24].

### [GATE-VERIFY] — ✅ PASS | 2026-06-29

**Phase 1 implementation merged to develop across 11 PRs:** A #878 (agent-core contract+port), B #879
(framework seam: askHandler + getUserInteraction + model-guard), C #880 (TUI PendingActionPrompt +
MultiSelectList), D #881 (TUI wiring), E #882 (programmatic/headless askUser), F #883 (/mode), G #884
(/preset + /language), H #885 (/exit + /clear confirm), I #886 (provider wizard), final deletion #887
(remove both legacy interaction systems), plus #887 review-cleanup follow-up.

Completion-criteria evidence (all commands exit 0):

- TC-01 — `agent-core` test: 742 passed (52 files); `IActionRequest`/`IUserInteraction.ask` type test green.
- TC-02 — `pnpm -w typecheck`: Done (all packages) — final state compiles with the legacy contracts removed.
- TC-03 — `rg "interactionHints|ICommandInteraction|TCommandInteractionPrompt|IPickItem|IPermissionRequest|\.interaction\b" packages/*/src` (excl. tests): no production matches.
- TC-04 — `agent-command` test: 210 passed; masked API-key request + duplicate-name re-ask loop asserted via the scripted `getUserInteraction()` double.
- TC-05 — `agent-transport` test: 43 passed; programmatic `askUser` answers from queue / cancelled on empty.
- TC-06 — `agent-transport-tui` test: 377 passed; `PendingActionPrompt` multi-select + masked (`*`) + Esc-cancels + input-gating.
- TC-07 — `agent-framework` test: 1024 passed; model-invocation ask guard resolves cancelled.
- TC-08 — `pnpm harness:scan`: all 33 scans passed.
- TC-09 — `pnpm --filter @robota-sdk/agent-transport-tui test:pty`: 9 passed (real built binary). New `provider-setup.ptytest.ts` drives `/provider add` → masked "Anthropic API key" field renders `*{15}`, snapshot never contains the secret, Esc → "Provider setup cancelled."

### [GATE-COMPLETE] — ✅ PASS | 2026-06-29

**Status upgrade:** in-progress → done

- Prior gate: GATE-VERIFY ✅ PASS above; all TC-01..TC-09 checkboxes `[x]` with command evidence.
- Phase 1 (single-channel action/UI separation) complete; the legacy dual-contract interaction systems are deleted and `askUser` is the sole ask seam.
- Phase 2 (WebSocket + web-ui multi-environment broadcast — first-answer-wins + idempotent resolve) remains a separate future track under this spec; not in Phase 1 scope.
