# SCREEN-004 Tasks

Generated from Completion Criteria.

- [x] TC-01: `formatStatusActivity({ activeToolCount: 7, ... })` returns `label === 'Tools (7)'` and `text` begins with `Tools (7)`
- [x] TC-02: `formatStatusActivity({ activeToolCount: 0, activeBackgroundTaskCount: 3, ... })` returns `label === 'Background (3)'`
- [x] TC-03: rendering `StatusBar` with `activeToolCount={2}` produces a frame containing `Tools (2)` and no occurrence of `Tools x2`
- [x] TC-04: `pnpm --filter @robota-sdk/agent-transport test` exits 0 with no new failures
- [x] TC-05: `pnpm --filter @robota-sdk/agent-transport typecheck` exits 0
