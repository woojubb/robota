# FLOW-004 Tasks (Layer 4 — monitor capability)

- [x] TC-01: matching output line → wake whose instruction includes the matched line
- [x] TC-02: non-matching output → no wake (+ partial line buffered until newline)
- [x] TC-03: burst of matches coalesces within the cooldown window
- [x] TC-04: agent-executor test suite exits 0 (82 passed)
- [x] TC-05: agent-executor typecheck exits 0 (framework typecheck green too)

Also: state-machine tolerates a running monitor's wake (no status change).
