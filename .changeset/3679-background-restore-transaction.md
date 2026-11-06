---
'@robota-sdk/agent-executor': minor
'@robota-sdk/agent-interface-session': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
---

Preserve restored background task identities and prepare scheduled tasks before resuming them. A resumed schedule activates only after a claim-fenced atomic store confirms a complete save; an unknown result stops initialization without assuming which record is present. Paused schedules stay paused, and a normal shutdown retains scheduled tasks for the next resume.

Custom stores and background managers must provide the restore transaction and prepared-schedule capabilities to resume scheduled tasks. A manager must also reserve restored IDs before a session with stored tasks can resume. These capabilities are optional for new sessions and sessions without stored tasks. An already-used manager is refused for a restore until it can establish per-session ownership.

This protects restore and restart boundaries; it does not promise exactly-once effects from arbitrary external commands.
