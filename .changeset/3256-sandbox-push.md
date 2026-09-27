---
'@robota-sdk/agent-cli': patch
'@robota-sdk/agent-subagent-runner': minor
'@robota-sdk/agent-tools': minor
---

A running child-process subagent follows a `/sandbox` change made in its parent session. Before, it
kept the settings it started with until it ended, so a long-running `auto`-mode subagent went on
auto-approving confined commands after the user turned auto-allow off.

- `agent-tools` (minor): `OsSandboxClient.watchSettings(watcher)` reports each `configure`, until
  its returned function is called.
- `agent-subagent-runner` (minor): the runner factory takes `watchParentSandboxSettings`, and
  forwards each change to every running child as a `sandbox_settings` message. It watches before
  reading the start payload, so no change is lost while a child starts, and stops when the child
  exits or fails to start. A composed sandbox may define `applyParentSettings`. The worker applies
  each change through it. On settings it cannot take, it aborts the run, lets a running command
  finish, and ends the run with that error.
- `agent-cli` (patch): robota watches its live sandbox, and a child applies each change to the
  instance its tools and approval read.
