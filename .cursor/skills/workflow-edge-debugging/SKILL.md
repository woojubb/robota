---
name: workflow-edge-debugging
description: Diagnose missing or zero workflow graph edges by following a role-based debugging order. Use when workflow graph debugging is needed or when edges are missing.
---

# Workflow Edge Debugging

## Scope
Use this skill when the UI workflow graph shows missing connections (e.g., edges are zero) or when connections are not transferred into the final graph.

## Preconditions
- The workflow graph is being built by a runtime workflow builder.
- Events are emitted and consumed by a subscriber.
- Connection extraction is expected to happen between node creation and graph assembly.

## Debugging Priority Order (role-based)
1. **Workflow Builder Logging**
   - Ensure the workflow builder emits debug logs for connection extraction.
   - If logs are silent, verify the builder receives a non-silent logger via dependency injection.

2. **Connection Extraction Stage**
   - Verify that nodes carry connection metadata at the time extraction runs.
   - Confirm that extraction runs after node creation and before graph assembly.

3. **Event Subscriber Handoff**
   - Ensure the event subscriber delivers the required event payloads to the builder.
   - Verify that explicit linkage fields are present in the event payload.

4. **Workflow Graph Assembly Integrity**
   - Check the final workflow graph object preserves extracted connections.
   - Validate that edges count increases when connections exist.

## Evidence Checklist
- [ ] Connection extraction logs appear.
- [ ] UI nodes show connection metadata before extraction.
- [ ] Subscriber payload contains explicit linkage fields.
- [ ] Final graph edges count reflects extracted connections.

## Actions
1. Enable or verify workflow builder logging.
2. Confirm extraction timing and node metadata availability.
3. Validate subscriber payload for explicit linkage fields.
4. Inspect final graph assembly for connection persistence.

## Success Criteria
- Connection extraction logs are visible.
- Workflow graph edges increase when connections exist.
- Graph assembly preserves extracted connections.

## Cache-Optimized Debugging
- Prefer cached execution data for repeated inspection.
- Re-run execution only when core logic changes.

## Stop Conditions
- If explicit linkage fields are missing, stop and fix the upstream event payload.
- Do not invent or infer relationships; rely only on explicit linkage data.
