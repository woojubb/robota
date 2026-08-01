# FLOW-002 Tasks (Layer 2 — session wake injection)

- [x] TC-01: wake event → one agent-wakeup turn with the instruction
- [x] TC-02: wake queues when a turn is executing (pendingPrompt + pendingTurnOptions)
- [x] TC-03: duplicate wakes for the same task id coalesce to one turn
- [x] TC-04: turn dispatched with turnSource 'agent-wakeup' + turn_source event
- [x] TC-05: agent-framework test suite exits 0 (918 passed)
- [x] TC-06: agent-framework typecheck exits 0 (transport + cli typecheck green too)
