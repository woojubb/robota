---
name: workflow-node-guidance
description: Provide workflow node creation guidance, anti-patterns, and checklists. Use when creating workflow nodes, linking edges, or applying path-only rules.
---

# Workflow Node Guidance

## Rule Anchor
- `.cursor/rules/workflow-event-rules.mdc`
- `.cursor/rules/execution-safety-rules.mdc`

## Scope
Use this skill when creating workflow nodes and edges based on explicit linkage data.

## Event Emission
- Emit events at meaningful state transitions.
- Let handlers decide whether to process events.

## Node Creation Guidance
- Link edges only with explicit linkage fields.
- Avoid inferring relationships from IDs or naming patterns.

## Node/Edge Creation Contract
- Relationship derivation priority:
  1. `context.ownerPath`
  2. explicitly allowed linkage fields in the event contract
- Never use ad-hoc fields (`parentAgentId`, `childAgentId`, `delegatingAgentId`, `delegatedAgentId`) to decide node/edge links.
- Those fields are allowed only as metadata for display/debugging, not for graph structure decisions.
- If linking cannot be derived from contract data, classify as `[EMITTER-CONTRACT]` and stop.

## Failure Classification (Operational)
- Classify failures as:
  - **`[EMITTER-CONTRACT]`**: missing/invalid required event or path-only fields.
  - **`[APPLY-LAYER]`**: node/edge apply failed after handler produced updates.
- In both cases, stop immediately (no fallback).  
- Use the label to route the fix to the right owner:
  - emitter/handler contract owner for `[EMITTER-CONTRACT]`
  - workflow apply/builder owner for `[APPLY-LAYER]`

## Anti-Patterns
- Conditional emission based on listeners.
- Defensive node creation that skips on missing data.
- Waiting for other events before emitting.

## Checklist
- [ ] Explicit linkage data is present.
- [ ] Edges are derived from explicit fields only.
- [ ] No fallback or inference paths are used.
