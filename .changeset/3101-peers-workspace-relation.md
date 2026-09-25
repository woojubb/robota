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
worktree — and re-reads it as it runs, so a first commit or a checkout does not leave it stale. The
reader does not take the claim as written: it reads git at the claimed path itself, and a claim whose
contents disagree is shown as `workspace claim mismatched, not believed` and relates to nothing. Those
git reads are local-only and asynchronous, run only for the view that shows the relation (and for
the sender of an incoming peer message), and are cached per announcement. The relation also reaches
the peer-turn origin, computed by the receiver; a relation the sender put on the wire is discarded,
and the admission never carries it.

The relation is display and routing information only and is never an authorization input.

Additive: `agent-interface-session-mobility` exports `TWorkspaceRelation` and gains the optional
`IPeerOrigin.workspaceRelation`; `agent-framework`'s `ILocalPeerSummary` gains the optional
`workspaceRelation` and `workspaceClaim`, and `ICommandLocalPeersAdapter` the optional
`listWithWorkspace()`.
