---
'@robota-sdk/agent-roundtable-robota': minor
---

A durable file recovery journal in the new `./node` subpath: `createFileRecoveryJournals(root)` returns the `recovery` option for `sessionParticipant`, one append-only owner-only file per conversation and participant under a `recovery-journal` directory it creates inside `root` (the root itself is never changed, so a shared directory is safe to pass), flushed before an append is acknowledged and refusing (never repairing) a torn tail, a gap, an unreadable line or an entry missing the fields its kind is read by. It needs only Node built-ins and agent-core, so it costs no native dependency.
