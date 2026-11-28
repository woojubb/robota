---
'@robota-sdk/agent-roundtable-robota': minor
---

A durable file recovery journal in the new `./node` subpath: `createFileRecoveryJournals(root)` returns the `recovery` option for `sessionParticipant`, one append-only owner-only file per conversation and participant, flushed before an append is acknowledged and refusing (never repairing) a torn tail, a gap or an unreadable line. It needs only Node built-ins and agent-core, so it costs no native dependency.
