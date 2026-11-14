---
'@robota-sdk/agent-framework': patch
---

An edit checkpoint store keeps its own state from being snapshotted as a project file by recognizing the state root by name, which failed on a volume that ignores case: the same directory reached as `.A/CP` instead of `.a/cp` was taken for an ordinary project file and captured. A path spelled another way is now inside the root when the directory it names at the root's depth is the root itself, as the volume reports it, so a case-variant spelling is recognised, a different directory is never taken for the root by its name, and a link to the root is not followed.
