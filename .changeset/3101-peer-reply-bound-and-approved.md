---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-cli': patch
---

A reply to a peer session asks the operator whenever a tool result is in the conversation, and it
goes only to the sender that was admitted.

- `agent-core` — `IPeerTurnAuthority.toolUsed` is now `toolOutputInContext`: what the model sees may
  hold a tool's output, from this turn or an earlier one. `peer_reply` asks whenever it is true.
- `agent-session` — a peer turn starts with `toolOutputInContext` set when the conversation holds a
  tool result from any earlier turn, the operator's included, or a compaction summary. The result of
  an earlier `peer_reply` does not count.
  `PermissionEnforcer.beginTurn` takes that as its second argument.
- `agent-framework` — `PeerMessageIngress` refuses a message whose origin names a sender other than
  the admitted one, or whose admission names no sender, and submits the turn with the admitted
  identity.
- `agent-cli` — a local peer message is taken as coming from the session it names only when that
  session confirms, at its own socket, that it is sending exactly that message to this receiver.
  The reply target, the driver id and the operator's notices come from the confirmed sender. A
  session on an earlier version cannot confirm, so its messages are refused; both sessions need this
  version to message each other.
