---
'@robota-sdk/agent-core': minor
---

Built-in read-only shell commands run without a prompt.

A Bash call whose every command is in the fixed read-only set (`ls`, `cat`, `grep`, `find` without
actions, `git status`/`log`/`diff`/`show` and similar) is decided like a read. It runs without a
prompt in every mode, `plan` included. Deny and ask rules still apply first. A command that writes
through a redirect, uses substitution, or runs git outside the session's repository takes the
ordinary path. New export: `isReadOnlyCommandLine`.
