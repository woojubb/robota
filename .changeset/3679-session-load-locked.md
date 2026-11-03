---
'@robota-sdk/agent-interface-session': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-ui-terminal': minor
'@robota-sdk/agent-ui-web': minor
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-interface-analytics': minor
'@robota-sdk/agent-session-analytics': minor
---

`TSessionLoadOutcome` gains a fifth status, `locked`: the record is there and sealed, and this
process cannot open it right now (`reason: 'no-keys'` when the store keeps its records `'plain'`,
`'changed'` when a held session's file changed since). `list()` leaves locked sessions out, since
there is no record to describe; the optional `scan()` returns the listing together with how many it
left out — `locked`, which an unlock would list, and an optional `noKeys` for those sealed with keys
this process does not have — and `scanSessionStore`/`listResumableSessions` in
`@robota-sdk/agent-framework` read it. `lockedSessionReason`, `lockedSessionMessage(id, reason)` and
`lockedSessionsNotice(locked, noKeys)` word a sealed session by why it does not open, so only locked
keys are ever met with "unlock"; resume, rename, hand-off, usage and the CLI's notices follow them. A
served session listing carries how many sealed sessions the host cannot open, its keys locked or
none that open them, as `lockedSessionCount`; the reason does not cross the wire, so the terminal
picker and the web session list say how many are sealed and not listed, never to unlock.

`@robota-sdk/agent-interface-analytics` adds an optional `IPersonalUsageCoverage.lockedSessions`, the
number of sealed sessions a usage report could not open (locked keys, or none that open them).
`@robota-sdk/agent-session-analytics` adds an optional `IPersonalUsageSnapshot.lockedSessionCount`,
which fills it, and the formatted report then reads `locked N` in its coverage line.

What to do: a `switch` over `outcome.status` handles `locked`; when you write, treat it like
`corrupt` (do not save over it). A surface that lists sessions can show `scan().locked` and
`scan().noKeys` so sealed sessions do not look deleted.
