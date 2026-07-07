# DATA-004 — unify dag-cli instant-node reload onto the owner round-trip

- **Status:** completed
- **Spec:** `.agents/spec-docs/done/DATA-004-dag-cli-instant-node-reload-unification.md`

## Outcome

Retired dag-cli's private duplicate of the instant-node deserializer (the DATA-003 Phase-3 follow-up):
`packages/dag-cli/src/local-runner/persistence/store.ts` now delegates prompt/composite parse +
reconstruct to the owner `@robota-sdk/dag-node-instant-node` (`parsePersistedInstantNode` /
`rehydrateInstantNode` / `isPersistableInstantNode`), keeping only the dag-cli-specific `code`-node
branch and `buildCompositeRunner`. ~70 lines removed. Behavior preserved (owner-written manifests);
the owner's stricter port validation only tightens hand-corrupted manifests. Full dag-cli 1007 tests
(incl. `composite-reload-real`, `code-node-persistence`, prompt round-trip) + 45/45 scans green.
