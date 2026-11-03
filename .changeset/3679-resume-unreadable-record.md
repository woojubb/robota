---
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-framework': minor
---

Resuming a session whose record is there but unreadable — corrupt, written by a newer build, or
sealed and locked — is refused instead of starting an empty session under that id, which the next
save would have written over the record. `robota -r <id>` (terminal UI and print mode alike) prints
`Cannot resume session <id>: …` and exits 1 before anything starts; `-r <name>` that matches no
readable session says how many sealed sessions are locked instead of "not found".
`InteractiveSession` throws the same refusal when given such a `resumeSessionId`, and
`resumeRefusal` is exported for hosts that check first.

What to do: repair, move or delete the record named in the message, or start a new session without
`-r`.
