---
'@robota-sdk/agent-core': patch
---

CORE-033: the abnormal paths now emit the required replay events, and history stays append-only

`provider_request`, `assistant_message_committed` and `history_mutation` are REQUIRED families, and
`agent-session` builds its session log from them: replaying every announced append, in order, is
supposed to reconstruct the conversation. Three engine sites appended without announcing, so the
reconstruction diverged at exactly the moments a reader goes to the log — the round cap, the
hard-capacity block, and a provider failure. On a capped run the summary the user actually read was
absent from every replay, and the provider call that produced it was invisible.

- The forced-summary call emits `provider_request` (`forcedSummary: true`, carrying the assembled
  messages), then `assistant_message_committed` and `history_mutation` for the summary it commits.
- The hard-capacity block announces its diagnostic — the only message explaining why the turn stopped.
- A provider failure announces the `Request failed: …` record it appends.

The forced-summary call also **rewrote** history: it appended a synthetic round-limit instruction,
sent it, then removed it with `clear()` + re-add — a non-append mutation this vocabulary has no way
to describe. The instruction is a per-call prompt artifact, so it no longer enters the conversation
store at all; it exists only in the outgoing array, the same shape the structured-output transport
uses for a schema instruction. Nothing is added, so nothing has to be removed, and `mutation` still
needs no removal member.

The item also reported that the streaming path emitted no families at all. CORE-042 had already
fixed that by removing the second engine — `runStream` runs the same `execute()` — and this change
adds the test that says so rather than leaving it assumed.
