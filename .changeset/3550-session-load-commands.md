---
'@robota-sdk/agent-transport-acp': minor
'@robota-sdk/agent-cli': minor
---

**An editor can reopen an earlier conversation over ACP and offer the agent's slash commands.**

`@robota-sdk/agent-transport-acp` sends `available_commands_update` once the editor holds the session
id — the runtime's commands and the user-invocable skills, each with its argument hint — and again
after a command that changed the list (a plugin reload, a preset). A host can supply `loadSession`;
the agent then offers `session/load`, checks it exactly like `session/new` (the served directory, no
editor MCP servers or extra roots, workspace trust), refuses it while a prompt runs, and replays the
loaded conversation — what was typed, what the agent answered, and each finished tool call — before
it answers. `IAcpTransportSession` now also needs the session's command listing and history display
reads, which a full interactive session has.

`robota acp` supplies the load: the editor may load any stored session of the folder it serves, and
the agent replaces its session with it. With `--no-session-persistence` nothing is stored, so loading
is not offered.
