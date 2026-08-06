---
'@robota-sdk/agent-interface-transport': major
'@robota-sdk/agent-framework': major
'@robota-sdk/agent-transport-mcp': major
---

**BREAKING — RUNTIME-003 P2: `submit` hands back the submission's identity, so an answer belongs to
the caller who asked for it.**

`submit` returned nothing, so a caller that needed to know when ITS turn ended had only the
session-global `complete` / `interrupted` / `error` events — which say that A turn ended and never
which one. The MCP adapter did exactly that, and the result was measurable: a session runs one turn
at a time and queues the rest, so two concurrent `submit` calls did not run concurrently. The second
waited and then took the RUNNING turn's response as its own answer. Both callers were told about one
turn; neither was told which.

`submit` now returns an `ITurnHandle` — `{ turnId, completed }`. The id is minted when the submission
is ACCEPTED and kept if it waits in the queue, so one submission is one identity from end to end.

`completed` always settles, and that is the part that took the work. A queued submission is not
promised a turn: the co-drive queue coalesces a same-driver input into the one behind it, drops at
capacity, and discards everything when cleared. A handle that settled only for submissions that ran
would leave the rest waiting forever — a worse failure than the ambiguity it replaces — so each of
those rejects with a typed `TurnNotRunError` naming which happened (`coalesced`, `dropped`,
`cancelled`, `shutdown`).

**Migration.** A caller that ignores the return value is unaffected: `await session.submit(...)`
still means what it did, and the direct path still resolves only when the turn is over. An
IMPLEMENTER of `IInteractiveSession` must now return a handle:

```ts
// before
async submit(input: string): Promise<void> {
  await runTurn(input);
}

// after
async submit(input: string): Promise<ITurnHandle> {
  const turnId = crypto.randomUUID();
  return { turnId, completed: runTurn(input) };
}
```

`createTestInteractiveSession` already returns a conforming handle, so a double built on it needs no
change.

Two things this deliberately does NOT do. The HTTP route's documented TOCTOU was measured and is not
reachable — nothing suspends between its busy check and the claim — so the comment asserting it was
corrected rather than a guard added for a race that does not exist; a regression case now pins the
observable outcome, because that safety is inherited from the router's scheduling rather than owned
by the route. And DAG run advancement (P3) stays with DAG-001.
