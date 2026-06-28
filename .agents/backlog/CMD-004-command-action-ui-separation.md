---
title: 'CMD-004: separate command interaction ACTION from UI (environment-agnostic, multi-transport)'
status: todo
created: 2026-06-28
priority: high
urgency: soon
area: packages/agent-interface-transport, packages/agent-framework, packages/agent-command, packages/agent-transport-tui, packages/agent-transport, packages/agent-cli, packages/agent-web-ui
depends_on: []
---

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
