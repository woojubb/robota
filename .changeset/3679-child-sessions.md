---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-mcp': patch
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-tools': patch
'@robota-sdk/agent-executor': patch
'@robota-sdk/agent-subagent-runner': patch
'@robota-sdk/agent-cli': patch
---

Children in their own session for secure mode (issue #3679). Nothing turns secure mode on yet, so
spawning in every product process is unchanged except for the pull-request opener below.

`@robota-sdk/agent-core/node` adds the child-session policy: `enableOwnChildSessions()` (one-way,
process-wide, nothing on Windows), `withChildSession(options)`, `execFileInChildSession(...)`,
`endWithProcess(child)` and `signalChildGroup(child, signal)`, with `resetChildSessionsForTesting()`
in `@robota-sdk/agent-core/testing`. While the policy is off each returns or runs exactly what the
caller did before. While on, a child leads its own session and process group, may not inherit a
terminal descriptor, and its group is killed when the process ends. Command hooks, the identity
readers, stdio MCP servers, git, the sandbox, background tasks and the CLI's own children use it; the
terminal handover (`/editor`, `/keybindings`, `/shell`, the workspace-move re-exec) does not.

Breaking: `removeProcessScopedDirectoriesNow()` is renamed `runProcessEndNow()`, since it now also
ends the groups of children in their own session. What to do: call `runProcessEndNow()` where a
crash handler called the old name.

Plain-mode change in `@robota-sdk/agent-cli`: the session view opens a pull request with the
product's own browser opener instead of the `open` package, which is no longer a dependency. macOS
still runs `open <url>`; Linux runs the `xdg-open` found on `PATH`; Windows runs
`rundll32 url.dll,FileProtocolHandler <url>` rather than PowerShell's `Start`; and only an https
link opens. What to do: nothing.
