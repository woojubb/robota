# FLOW-005 Tasks (Layer 5 — /schedule + /monitor command surface)

- [x] TC-01: `/schedule in <N><unit> <instruction>` spawns a one-shot scheduled wake (ISO nextFire)
- [x] TC-02: `/schedule cron "<expr>" <instruction>` spawns a recurring scheduled wake
- [x] TC-03: invalid `<when>` rejected with a clear error, no task spawned
- [x] TC-04: `/monitor "<cmd>" "<pattern>" <instruction>` spawns a process+match wake task
- [x] TC-05: agent-command (177) + agent-cli (152) test suites exit 0
- [x] TC-06: typecheck exits 0 for affected packages (framework/command/cli)

Foundation: host-context spawnScheduledWake/spawnMonitorWake bridge + InteractiveSession impl.
