---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-provider-anthropic': patch
'@robota-sdk/agent-provider-openai-compatible': patch
'@robota-sdk/agent-session': patch
'@robota-sdk/agent-tools': patch
'@robota-sdk/agent-interface-session': patch
'@robota-sdk/agent-interface-session-mobility': patch
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-ui-terminal': patch
'@robota-sdk/agent-cli': patch
---

A local peer can now be answered, and what its turn may do depends on where it runs.

- `agent-core`: the permission evaluator takes a peer turn's authority as one more input
  (`IPermissionEvaluationContext.peerTurn`), decided after the deny list and ceiling and before
  bypass and allow rules. A peer on another host uses no tool. A peer on the same host may use an
  inspect-class tool that declares `workspacePaths`, only when every named location resolves inside
  the workspace and is not a credential (`isSecretPath`); write and execute tools are refused unless
  enabled, and then every use asks. A tool declaring `repliesToPeer` exists only in a peer turn and
  asks once the turn used another tool. New: `isToolAvailableInPeerTurn`, `TPeerReach`,
  `IPeerTurnAuthority`. `IRunOptions.withholdHostedTools` leaves a provider's hosted tools out of a
  run's requests (`nativeWebTools` with `false` withholds a hosted tool for one call).
- `agent-tools`: `Read` and `Glob` declare the arguments that say where they look. `Grep` does not:
  it reads files it was never named, so a peer turn does not get it.
- `agent-session`: `ISessionRunOptions.peerReach` makes a run a peer turn for the permission policy;
  every ask in it needs a fresh approval, and its requests carry no provider-hosted tool. `ISessionOptions.allowPeerChanges` enables write and execute
  tools for same-host peer turns.
- `agent-interface-session`: `ISubmitOptions.peer` (`IPeerTurnContext`) carries a peer turn's reach,
  the message it answers and the session a reply goes to.
- `agent-interface-session-mobility`: `IPeerMessage.inReplyTo` threads a conversation;
  `peerReachOf(admission)` maps admission to a reach.
- `agent-framework`: a peer turn is offered what its origin allows, and a new `peer_reply` tool
  answers the peer that sent the message, threaded to it. The setting `peers.allowChanges` enables
  write and execute tools for same-host peer turns.
- `agent-ui-terminal`: a permission prompt in a peer turn names the requesting peer.
- `agent-cli`: incoming peer turns carry their reach and reply route; a conversation is limited in
  depth and in how often this session answers it, and a reply over a limit is not sent and the
  operator is told.
- `agent-provider-anthropic`, `agent-provider-openai-compatible` (Qwen): a request whose
  `nativeWebTools` sets a hosted tool to `false` is sent without it.
