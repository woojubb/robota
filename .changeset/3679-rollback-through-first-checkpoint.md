---
'@robota-sdk/agent-interface-session': patch
'@robota-sdk/agent-session': patch
'@robota-sdk/agent-framework': patch
---

Rolling back through a session's first checkpoint now survives a resume. The next turn after such a
rollback starts a fresh root line, as documented, but the saved session kept no pointer for that
cleared head, so a resumed session continued the line that was rolled back. The session record now
saves `activeBranch` as `{ branchId, checkpointId: null }` for it, and `IActiveBranchPointer.checkpointId`
is `string | null`.

What to do: code that reads `activeBranch.checkpointId` handles `null`, which means the head was
cleared on purpose, not that the pointer is missing.
