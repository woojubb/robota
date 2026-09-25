---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-session': minor
---

Built-in read-only shell commands run without a prompt.

A Bash call is decided like a read, and runs without a prompt in every mode (`plan` included), when
every command in it comes from the fixed read-only set (`ls`, `cat`, `grep`, `find` without actions,
`git status`/`log`/`diff`/`show` and similar) and it also:

- stays inside the workspace: every path operand resolves inside once symlinks are followed, as
  `Read` requires;
- uses only printable ASCII syntax that bash, zsh, fish and PowerShell all read the same way.

Deny and ask rules still apply first. A command that writes through a redirect, expands or
substitutes anything, or runs git outside the session's repository takes the ordinary path.

New exports: `isReadOnlyCommandLine` and `TResolveInWorkspace`. `IPermissionEvaluationContext`
gains `resolveInWorkspace`, which `PermissionEnforcer` supplies.
