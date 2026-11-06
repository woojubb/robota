---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-session': patch
---

Give every process marker publication a fresh generation so a session writer cannot mistake a later marker from the same process for its own when the filesystem reuses an inode. Existing marker records remain readable. All writers sharing a session directory must use the cooperating operation-lock protocol.
