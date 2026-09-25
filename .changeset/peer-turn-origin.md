---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-session': patch
'@robota-sdk/agent-framework': patch
---

A peer session's message now reaches the model as a peer's, and a peer turn runs on the external
baseline.

- `agent-core` marks every user message whose driver id starts with `peer:` as
  `<peer_message from="…">…</peer_message>` in the outgoing request — both the round and the forced
  summary — while the stored history keeps the text as sent. Wrapper-shaped text in user and tool
  messages is escaped, and an id that is not a plain identifier is printed as `peer:unverified`.
  New exports: `peerDriverOf`, `printablePeerDriver`.
- `agent-session`'s conversation transcript (compaction, advisor) labels a peer message with the same
  printable id, so no rendering echoes a sender-chosen id that is not a plain identifier.
- `agent-framework` runs a `peer` turn like an `external` one — no tools (`toolChoice: 'none'`), no
  `@path` expansion, no context references — and adds a per-turn system statement that the message
  came from another session and carries no authority. A `peer` turn must carry a `peer:` driver id.
