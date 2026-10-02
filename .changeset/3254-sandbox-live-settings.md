---
'@robota-sdk/agent-cli': patch
'@robota-sdk/agent-subagent-runner': minor
---

A child-process subagent confines and approves commands with its parent's sandbox settings as they
stand when it starts. Before, it read its root's settings files, so a `/sandbox` change made in the
session did not reach it. `/sandbox` changes the live sandbox and only the user settings file, which
project settings outrank. A worktree child also missed the parent's untracked local settings.

- `agent-subagent-runner` (minor): the runner factory takes `parentSandboxSettings`, read at each
  spawn. The start payload carries it, the IPC guard checks it is a record, and the worker hands it to
  `createSandbox` as `parentSettings`.
- `agent-cli` (patch): the configured CLI sends its live sandbox's settings, and a child builds its sandbox from
  them. It refuses settings it cannot read rather than falling back to the files.
