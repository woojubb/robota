---
'@robota-sdk/agent-executor': minor
'@robota-sdk/agent-interface-session': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
---

Preserve restored background task identities and prepare scheduled tasks before resuming them. A resumed schedule activates only after a claim-fenced atomic store confirms a complete save; an unknown result stops initialization without assuming which record is present. Paused schedules stay paused, and a normal shutdown retains scheduled tasks for the next resume.

Restoring scheduled tasks requires the built-in background manager and scheduled runner, and a store that supplies the restore transaction and verifies its writer claim. Custom managers and scheduled runners remain available for new tasks, but their saved schedules cannot be resumed. A manager must reserve restored IDs before a session with stored tasks can resume; an already-used manager is refused for a restore.

This protects restore and restart boundaries; it does not promise exactly-once effects from arbitrary external commands.
