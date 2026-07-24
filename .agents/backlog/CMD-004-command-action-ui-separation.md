---
title: 'CMD-004: separate command interaction ACTION from UI (environment-agnostic, multi-transport)'
status: in-progress
created: 2026-06-28
priority: high
urgency: soon
area: packages/agent-interface-transport, packages/agent-framework, packages/agent-command, packages/agent-transport-tui, packages/agent-transport, packages/agent-cli, packages/agent-transport-gui
depends_on: []
---

> **Phase 1 delivered (2026-06-28 ~ 2026-06-30)** via the CMD-004 spec/task pipeline (task archived at
> `.agents/tasks/completed/CMD-004.md`, spec at `.agents/spec-docs/done/CMD-004-*.md`): PRs A–I + the
> final legacy deletion (#887, removing `IInteractionChannel.requestAction` / `ICommandResult.interaction`
> across 5 packages) + TC-09 real-binary PTY evidence (#888). `askUser` is now the single UI-agnostic
> action seam; TUI + programmatic channels render it per-environment; TC-01..TC-09 evidence is in the
> spec's Evidence Log. **CMD-005 is unblocked.**
>
> **This item stays open for Phase 2 only:** the WS + web-ui **multi-environment broadcast** (two
> attached environments rendering the same ask simultaneously) — per the completed task's closing note.
>
> **Phase 2 re-scoped + in progress (2026-07-25):** the ask broadcast was already delivered by
> REMOTE-007/009; the actual residual defect is the **command-effect half** — see the approved spec
> `.agents/spec-docs/active/CMD-004-command-action-ui-separation.md` (status: in-progress) and task
> breakdown `.agents/tasks/CMD-004-phase2.md`. **Stages A (additive split contract:
> `TCommandHostAction`/`TCommandUiIntent`, `ui_intent` + `session_renamed` events, command-origin
> driver id) and B (session-layer host-action executor over `ICommandHostAdapters` + legacy-effect
> shim + ws-handler `ui_intent` forward + per-mode process adapters) are implemented** with red-first
> TC-03/TC-10 evidence in the spec's Evidence Log. Remaining: Stage C (TUI → pure renderer), Stage D
> (GUI/headless surfaces + multi-surface exit policy e2e), Stage E (emitter migration + legacy
> `TCommandEffect` deletion + grep/typecheck floors).
>
> **Phase 2 spec drafted (2026-07-24):** GATE-WRITE draft at
> `.agents/spec-docs/draft/CMD-004-command-action-ui-separation.md`. Code-grounded re-scope: the ask
> broadcast half was already delivered by REMOTE-007/009 (`SessionPromptRegistry` + `ask_request` over
> WS + GUI prompt rendering); the remaining action↔UI coupling is the **command-effect half** —
> `TCommandEffect` is TUI-named, executed only by the TUI renderer (incl. settings writes in
> `command-effect-handler.ts`), and silently dropped by `ws-handler` `command_result` and all
> non-TUI surfaces. The draft splits it into host-executed actions (session +
> `ICommandHostAdapters`) vs requester-routed UI intents (`ui_intent` event), staged A–E. Awaiting
> GATE-APPROVAL.
>
> **Phase 2 GATE-APPROVAL passed (2026-07-24):** reviewer REVISE — architecture approved, 8 binding
> revisions folded into the spec (now `approved`, moved to `.agents/spec-docs/todo/CMD-004-*.md`);
> next: GATE-IMPLEMENT.

# Separate command interaction ACTION from UI

The foundation refactor: an interactive command's **action** (the request "ask the user to pick /
confirm / choose multiple / type a value") must be **UI-agnostic**, and **how it is rendered is each
environment's job** (Ink TUI dialog, web modal, programmatic answer). Design this cleanly and
completely; the question-dialog tool (CMD-005) then migrates onto it.

## Motivation

The same `InteractiveSession` can be driven from **multiple environments at once** — e.g. a remote web
client showing a web UI **and** a terminal TUI rendering simultaneously over the same session. So an
interaction is fundamentally **one action** ("the agent/command needs an answer from the user"), and
the **UI is per-environment**. Coupling the action to a specific renderer (TUI) breaks the moment a
second environment is attached.

The seam partly exists — `IInteractionChannel.requestAction(TActionRequest): Promise<TActionResponse>`
(agent-interface-transport) is already the action↔UI port, with the TUI channel rendering it as an Ink
dialog and the programmatic channel answering from a queue. But:

- The action contract is narrow: only `pick` (single, no free-text) and `confirm`. No multi-select, no
  "choose an option **or** type your own" (the shape the agent actually needs).
- `requestAction` is only triggered by **command interaction hints** in `createInteractiveRuntime`; the
  **agent (model) cannot issue an action** itself (that gap is CMD-005).
- Some assembled command modules reach into host adapters / TUI-specific behavior rather than
  expressing their interaction purely as a UI-agnostic action (coupling signal observed across
  `agent-command` modules: schedule, compact, context, memory, mode, preset, shell, reset, background).

## Goal (design completely before implementing)

A clean, complete design where:

- The **interaction action contract** is the SSOT in `agent-interface-transport`, generalized to cover
  single-select (with optional free-text entry), multi-select, and confirm — and is the ONLY thing a
  command/agent produces for an interaction.
- Every transport provides a **rendering adapter** for that contract (TUI Ink dialog, web modal,
  programmatic queue/auto-answer); no command knows which UI renders it.
- Assembled commands are **audited and decoupled**: any command currently bound to TUI rendering or
  TUI-only host behavior expresses its interaction as an action through the channel port instead.
- The design accounts for **multi-environment concurrency** (≥1 channel attached to one session): which
  environment(s) render an action and how a single answer resolves it.

## Open Design Questions (resolve during the design/GATE-WRITE phase)

1. **Action contract shape**: exact `TActionRequest`/`TActionResponse` extension for single-select +
   free-text and multi-select (min/max selections, validation, default, cancel). One unified `ask`
   action vs. distinct variants.
2. **Who issues actions**: command interaction hints (today) vs. the agent/model (CMD-005) vs. both —
   one routing path through the channel port.
3. **Multi-environment concurrency**: with web + TUI on one session, does every attached channel render
   the action? First-to-answer wins? Designated primary? How are the others dismissed?
4. **Command decoupling**: per-command audit — which `agent-command` modules are TUI/host-coupled, and
   the target shape (host-adapter port vs. pure action) for each.
5. **Headless / no-UI**: how an action resolves when no interactive renderer is attached (programmatic
   queue, default, or terminal error) — consistent with the existing `cancelled` semantics.
6. **Relationship to existing contracts**: how this generalizes `requestAction` + `interactionHints`
   without breaking the TUI/programmatic channels already built (pre-release — interfaces may change).

## Affected Scope (preliminary)

- `agent-interface-transport` — generalize the action contract (SSOT).
- `agent-framework` — `createInteractiveRuntime` action routing; command interaction wiring.
- `agent-command` — decouple coupled modules to action-only interactions.
- `agent-transport-tui` — Ink dialog rendering adapter for the generalized contract.
- `agent-transport` — programmatic adapter; `agent-cli` — composition wiring.
- `agent-web-ui` / `agent-web` — web modal rendering adapter (so web + TUI can both render).

## Notes

- Idea captured per the backlog process; **design is intentionally deferred** — this item is the
  problem + intent. The complete design happens in its own design/GATE-WRITE pass before implementation.
- CMD-005 (model-invocable question dialog + migration) depends on this foundation.
- Respect layering ([[code-quality.md Layered Assembly]], no shared product factory): the action
  contract is a lower-layer interface; UI rendering is per-transport; agent-cli only composes.
