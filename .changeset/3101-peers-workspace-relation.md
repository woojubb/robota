---
'@robota-sdk/agent-interface-session-mobility': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-cli': minor
---

`/peers` shows how each other local session's workspace relates to this one's: `same worktree`,
`same repo`, `different repo`, or `workspace unknown`.

A session now publishes a workspace claim with its rendezvous entry — the root commits reachable
from HEAD, a SHA-256 of its normalized `origin` URL (never the URL itself), and the real path of its
worktree. The reader does not trust the claim: it resolves the claimed path and reads git there
itself, and a claim that disagrees is shown as `workspace claim mismatched, not believed` and relates
to nothing. The relation also reaches the peer-turn origin, computed by the receiver; a relation the
sender put on the wire is discarded, and the admission never carries it.

The relation is display and routing information only and is never an authorization input.

Additive: `agent-interface-session-mobility` exports `TWorkspaceRelation` and gains the optional
`IPeerOrigin.workspaceRelation`; `agent-framework`'s `ILocalPeerSummary` gains the optional
`workspaceRelation` and `workspaceClaim`.
