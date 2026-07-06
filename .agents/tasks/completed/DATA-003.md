# DATA-003 — instant-node provider SSOT + symmetric persistence round-trip

- **Status:** completed (merged #1005 → #1006; released in 3.0.0-beta.79)
- **Spec:** `.agents/spec-docs/done/DATA-003-instant-node-provider-ssot-and-round-trip.md`

## Outcome

Owner `@robota-sdk/dag-node-instant-node` now owns both halves of its data model:
`INSTANT_NODE_PROVIDERS` (runtime SSOT, `TInstantNodeProvider` derived) + `isInstantNodeProvider`, and
`parsePersistedInstantNode` / `rehydrateInstantNode` (both kinds; composite needs an injected runner
else throws) + `isPersistableInstantNode`. Consumer `@robota-sdk/agent-command-workflows` dropped both
duplicated provider arrays and the `as unknown as` double-cast and delegates to the owner;
`saveInstantNodeFile` refuses composites (no unreloadable orphan). 7 owner round-trip tests + 3 consumer
writer tests + 28 consumer unit + a deterministic real-LLM reload round-trip; 45/45 scans; 0 lint errors.

## Follow-up

- `dag-cli`'s private duplicate reconstruction (`store.ts`) may later delegate to the owner
  `rehydrateInstantNode` to unify the two copies (deferred; noted in the spec).
