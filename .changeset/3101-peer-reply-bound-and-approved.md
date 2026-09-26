---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-cli': patch
---

A reply to a peer session is decided by the permission system like any call that sends something
off this machine, and it goes only to the sender that was admitted.

- `agent-core` — a tool declaring `repliesToPeer` is still refused outside a peer turn; inside one it
  is decided by the ordinary steps: deny, ask and allow rules, then the mode. It declares no risk
  class, so it asks by default, is refused in plan mode and proceeds under bypass. `IPeerTurnAuthority`
  no longer has `toolUsed`.
- `agent-session` — an "always allow" answer to the reply is remembered and answers later replies,
  as for any tool; other asks in a peer turn still need a fresh approval each time.
- `agent-framework` — `peer_reply` asks the operator by default, showing the full text and the peer
  it goes to; `permissions.allow`/`deny` rules naming `peer_reply` apply. `PeerMessageIngress`
  refuses a message whose origin names a sender other than the admitted one, or whose admission names
  no sender, and submits the turn with the admitted identity.
- `agent-cli` — a local peer message is taken as coming from the session it names only when that
  session confirms, at its own socket, that it is sending exactly that message to this receiver.
  The reply target, the driver id and the operator's notices come from the confirmed sender. A
  session on an earlier version cannot confirm, so its messages are refused; both sessions need this
  version to message each other.
