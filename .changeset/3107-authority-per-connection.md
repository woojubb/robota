---
'@robota-sdk/agent-interface-session-mobility': minor
'@robota-sdk/agent-transport-webrtc': minor
'@robota-sdk/agent-command': patch
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-cli': minor
---

Authority per connection: pairing stays with the local operator, and driving needs the operator's yes.

- `agent-interface-session-mobility` — `ConnectionAuthority` decides what one connection may do.
  `presence` and `message` are allowed; `delegate` and `handoff` ask the receiving operator for every
  request; `observe` and `drive` ask once per connection. With no `IOperatorApprover` the answer is
  no. `authorizeDelegation` turns an approved task into a peer turn from where admission placed the
  peer, ignoring anything else on the request, so the receiver's policy decides what it may do.
- `agent-transport-webrtc` — `connectionApproval` asks the operator before a connection reaches the
  session, after every proof has run. Frames the peer sends meanwhile are held (bounded) and delivered
  only after a yes. A first-pairing device is pinned for reconnect only once it is admitted.
- `agent-command` — `/remote-control enable` and `revoke` from a connected surface are refused, and
  `status` never shows a connected surface the pairing link.
- `agent-framework` — the `remote-control-enable` host action runs only for the operator's own
  command, whichever command asked for it.
- `agent-cli` — every remote-control connection, a returning trusted device included, is put to the
  operator on the host terminal; without an interactive terminal it is refused.
