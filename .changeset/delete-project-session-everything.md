---
'@robota-sdk/agent-cli': patch
---

Deleting a project session now removes everything it left: its log, payloads, edit checkpoints and subagent logs, then its record, leaving only the claims guard file. A checkpoint writer still using the session stops the delete with its checkpoints and record kept, deleting again finishes a delete that stopped part-way, and a workspace-root broker started by an older CLI is reported as one to restart. The turn directories a crashed checkpoint writer left are reclaimed at the session's next turn. The CLI also ships this release's SDK fixes: restoring checkpoints of files whose names start with `..`, task events saved without growing every save, and a question before switching away from a session with background work.
