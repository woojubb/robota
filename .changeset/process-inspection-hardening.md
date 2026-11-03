---
'@robota-sdk/agent-cli': patch
---

The shipped CLI and headless executables, and the daemon and worker children they re-execute, now keep other programs of the same user from reading them: on Linux each process makes itself undumpable, so its memory and environment cannot be read or traced, and on Node the signal that opens the inspector is held, with re-executed Node children also started with `--disable-sigusr1` where their Node accepts it. A host embedding `startCliEntry` in its own process is unchanged.
