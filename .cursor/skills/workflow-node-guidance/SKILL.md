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

## Anti-Patterns
- Conditional emission based on listeners.
- Defensive node creation that skips on missing data.
- Waiting for other events before emitting.

## Checklist
- [ ] Explicit linkage data is present.
- [ ] Edges are derived from explicit fields only.
- [ ] No fallback or inference paths are used.
