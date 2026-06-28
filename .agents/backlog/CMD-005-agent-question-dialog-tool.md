---
title: 'CMD-005: model-invocable question dialog tool (single-select + free-text, multi-select) on the CMD-004 action layer'
status: todo
created: 2026-06-28
priority: high
urgency: soon
area: packages/agent-interface-transport, packages/agent-framework, packages/agent-tools, packages/agent-cli, packages/agent-transport-tui, packages/agent-web-ui
depends_on: [CMD-004]
---

# Model-invocable question dialog tool

Let the **agent (model) ask the user a question mid-conversation** — exactly like the assistant's own
AskUserQuestion dialog: choose one of the offered options **or type a custom answer**, and a
**multi-select** variant. Built on the CMD-004 action/UI separation, then **migrate the existing dialog
interactions onto it**.

## Motivation

Today the agent cannot solicit a structured answer from the user; only slash-command interaction hints
trigger a dialog (`requestAction`), and only as single-`pick`/`confirm`. We want the agent to issue a
question as a **UI-agnostic action** that any attached environment renders its own way (TUI Ink dialog,
web modal) — and resolve to a structured answer fed back to the model. This is the natural consumer of
CMD-004's generalized action contract.

## Goal (after CMD-004 is designed)

- A **model-invocable tool** (AskUserQuestion-equivalent) that issues a question **action** through the
  interaction channel and returns the user's answer to the model.
- Supports **single-select with free-text** (pick an option or type your own) and **multi-select**.
- UI-agnostic: the tool produces an action; each environment (TUI/web/programmatic) renders it via its
  CMD-004 rendering adapter. Works when web + TUI are attached to the same session simultaneously.
- **Migrate** existing dialog/`requestAction` usages (command interaction hints, etc.) onto the
  generalized CMD-004 contract so there is one interaction path, not two.

## Open Design Questions (resolve during the design/GATE-WRITE phase)

1. **Tool surface**: the tool's schema (how the model declares options, multi-select, free-text-allowed,
   min/max, header/labels) and where the tool lives (`agent-tools` vs. an interaction-layer tool vs. a
   command). Must stay provider-neutral.
2. **Answer flow**: how the structured answer (selected option(s) and/or typed text) returns to the
   model as a tool result; how cancellation is represented.
3. **Permission/safety**: is asking the user gated, and how it behaves under each permission mode.
4. **Headless / no-UI**: behavior when no interactive renderer is attached (print mode, automation) —
   programmatic answer, default, or a clear tool error; never a silent guess.
5. **Migration scope**: enumerate current dialog/`requestAction` call sites and move each to the new
   contract; remove the narrow `pick`/`confirm`-only path once migrated (pre-release — no compat debt).

## Affected Scope (preliminary)

- `agent-tools` (or interaction layer) — the model-invocable question tool.
- `agent-interface-transport` / `agent-framework` — action issuance from the agent + result routing
  (built on CMD-004).
- `agent-transport-tui` / `agent-web-ui` — render single-select+free-text and multi-select dialogs.
- `agent-cli` — compose the tool into the product; migrate existing dialog usages.

## Notes

- **Blocked on CMD-004** (the action/UI separation must be designed first). This item is captured now so
  the migration is planned alongside the foundation.
- Mirrors the assistant's own AskUserQuestion affordance (single-select/free-text + multi-select) as the
  target UX.
- Design deferred — this is the problem + intent; complete design happens in its own GATE-WRITE pass.
