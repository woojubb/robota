---
'@robota-sdk/agent-framework': patch
---

Restoring or rolling back an edit checkpoint threw "outside the authorized project" for a checkpointed file whose name merely starts with two dots, such as `..notes.txt`, because the check read any path beginning with `..` as an escape. A path now leaves the project only when its first segment is exactly `..` or it is anchored on another root, so these files restore and roll back like any other, and real escapes are still refused.
