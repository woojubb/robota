---
'@robota-sdk/agent-transport-link': minor
'@robota-sdk/agent-keyring': patch
'@robota-sdk/agent-cli': patch
---

The runtime half of owner-link admission, first pieces (issue #3679). Nothing turns secure mode on
yet, so no runtime or command changes behaviour.

`@robota-sdk/agent-transport-link` adds the spawner pair: `answerSpawnerPair` is the runtime's end of
the exchange over the descriptor it inherited (synchronous, closing the descriptor on every path) and
`completeSpawnerPair` is the spawner's end, with `SPAWNER_PAIR_FD` and `SpawnerPairError`. An admitted
link now reports `pendingBytes()` so a runtime can cut a client that stopped reading, and its
`close()` delivers what is queued, for a bounded grace (`closeFlushTimeoutMs`, default 5 s), before it
cuts, so an answer sent just before is not lost.

`@robota-sdk/agent-keyring` exports the exchange's message lengths. `@robota-sdk/agent-cli`'s
`KeyHolder` can take the read keys of an owner link (`unlockWithGrant`): it reports a keyring file
that holds another sealing key as a mismatch and leaves the file alone.

What to do: nothing.
