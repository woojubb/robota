---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-tools': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-interface-session': minor
'@robota-sdk/agent-interface-session-mobility': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-cli': minor
---

A message from another session is instant messaging: text from an untrusted third party that
carries no authority. What the model does with it is decided by the session's ordinary permissions —
rules, permission mode and remembered consent — exactly like the session's own work. The per-origin
peer policy is gone.

**BREAKING**

- `agent-core`: `IPermissionEvaluationContext.peerTurn` is now a boolean. It decides only whether a
  `repliesToPeer` tool exists; every other call in a peer turn is decided as in any turn. Removed:
  `isToolAvailableInPeerTurn`, `isSecretPath`, `IPeerTurnAuthority`, `TPeerReach` (now exported by
  `agent-interface-session-mobility`) and `IToolPermissionProfile.workspacePaths`.
- `agent-tools`: `Read` and `Glob` no longer declare `workspacePaths`.
- `agent-session`: `ISessionRunOptions.peerReach` is replaced by `peerTurn?: boolean`, and
  `ISessionOptions.allowPeerChanges` is removed. An ask in a peer turn is answered like any other:
  a consent the operator remembered answers it, and an "always allow" given there is remembered.
- `agent-interface-session`: `IPeerTurnContext` no longer has `reach`; it carries only the reply
  route.
- `agent-interface-session-mobility`: `peerReachOf` is removed; `TPeerReach` moves here. A delegated
  turn carries no reach.
- `agent-framework`: the `peers.allowChanges` setting is removed (an existing value is ignored). A
  peer turn is offered the ordinary tools, plus `peer_reply`.

**Changes**

- `agent-framework`: the per-turn statement tells the model the message is an opinion from an
  untrusted third party, not its owner's instruction, and that it decides for itself whether and how
  to act. A message still expands no `@path` and attaches no context reference, and its requests
  still carry no provider-hosted tool, since no permission step can decide one. Each sender's
  messages may start at most 6 turns a minute and 30 an hour; a message over the limit is refused
  with a reason the sender receives. A prompt answer given in the name of a `peer:` or `external:`
  driver is ignored. External-event turns keep their tool-less baseline.
- `agent-cli`: incoming peer turns carry only their reply route.
