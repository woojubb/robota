---
'@robota-sdk/agent-cli': patch
---

The workspace-root broker removes a project state directory on a client's behalf through the framework's pinned, same-mount removal, in bounded steps answered as removed, absent or partial, and a repeated operation id gets the recorded answer instead of a second removal. A broker started by an older CLI does not know the operation; the client then says to restart the workspace-root broker instead of reporting a malformed request. Nothing calls the removal yet.
