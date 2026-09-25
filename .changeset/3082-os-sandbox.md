---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-tools': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-cli': minor
---

Shell commands can run in an OS-level sandbox: bubblewrap on Linux and WSL2, Seatbelt on macOS.

- **Confinement:** covers the command and every process it starts.
  - Writes are limited to the working directory, the temporary directories and
    `sandbox.filesystem.allowWrite`.
  - Agent, git-hook, MCP and shell configuration inside the workspace stays read-only.
  - `sandbox.filesystem.denyRead` hides paths from the command.
  - The network is on or off (`sandbox.network.enabled`).
- **Modes:** `/sandbox` switches between `auto-allow`, `regular` and `off` for the next command and
  saves the choice.
  - In `auto-allow` (`sandbox.autoAllowBashIfSandboxed`), a confined command runs without a prompt
    in `default` and `acceptEdits`.
  - Deny rules, ask rules, critical removals and plan mode still apply first.
- **Exclusions:** `sandbox.excludedCommands` run unconfined, through the ordinary permission path.
- **When the sandbox cannot run:** a missing or unusable backend is reported at startup, in
  `robota doctor` and in `/sandbox`, and commands then run unconfined.
  `sandbox.failIfUnavailable` refuses to start instead.
- **New contracts:**
  - `OsSandboxClient`, `detectOsSandbox`, `bubblewrapArguments`, `seatbeltProfile`.
  - `ISandboxClient.wrapCommand` and `autoApproves`.
  - `IPermissionEvaluationContext.sandboxAutoApproved`.
  - The `commandSandbox` session option.
  - The `sandbox` settings key and the `sandbox` command host adapter.
