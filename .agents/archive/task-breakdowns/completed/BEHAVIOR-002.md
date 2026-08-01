# BEHAVIOR-002 Tasks

Generated from Completion Criteria.

- [x] TC-01: fake `robota.run` firing `assistant_message_committed` twice → `onContextUpdate` called ≥ 3 times
- [x] TC-02: emitted `usedTokens` are non-decreasing across the turn
- [x] TC-03: non-round events do not trigger an extra `onContextUpdate` (only `assistant_message_committed` does)
- [x] TC-04: `pnpm --filter @robota-sdk/agent-session test` exits 0 with no new failures (63 passed)
- [x] TC-05: `pnpm --filter @robota-sdk/agent-session typecheck` exits 0
- [x] TC-06: live check — real binary print-mode multi-round turn fired `assistant_message_committed` 4× in a single turn (3 tool rounds + final), proving per-round context emission end-to-end
