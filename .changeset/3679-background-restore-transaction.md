---
'@robota-sdk/agent-executor': minor
'@robota-sdk/agent-interface-session': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
---

Preserve restored background task identities and prepare scheduled tasks before resuming them. A resumed schedule activates only after a claim-fenced atomic store confirms a complete save; an unknown result stops initialization without assuming which record is present. Paused schedules stay paused, and a normal shutdown retains scheduled tasks for the next resume.

When a claimed session has a background manager, it requires an exclusively bound built-in manager. Scheduled tasks in a claimed session require the built-in scheduled runner and a verifiable writer claim. Restoring schedules also requires a store that supplies the restore transaction. Custom managers and scheduled runners remain available to unpersisted sessions, but their saved schedules cannot be resumed. A manager must reserve restored IDs before a session with stored tasks can resume; an already-used manager is refused for a restore.

This protects restore and restart boundaries; it does not promise exactly-once effects from arbitrary external commands.

When a claimed session detects that it no longer owns the writer claim, it stops admitting wakes and reports a failure without saving over the new owner. In-flight subprocess cancellation is best effort. Ownership checks cannot be atomic with external effects, and a process that has already started may still have effects.
