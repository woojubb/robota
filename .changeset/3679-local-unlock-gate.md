---
'@robota-sdk/agent-ui-terminal': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-framework': minor
---

The local unlock gate for secure conversations (issue #3679), dormant until secure mode can be turned
on: no product process is given a key holder yet, so nothing below runs and nothing reads differently.

- `@robota-sdk/agent-ui-terminal` exports the key custody port types (`IKeyCustodyPort`,
  `TUserReadRequest`, `TReadPurpose`, `TReadability`) and `isUserReadRequest`, which answers whether
  the UI's own mint made a request: an object of the same shape made by a cast is not one.
  `ITuiCliAdapter` gains an optional `keyCustody`. Attaching to a fork sealed while the keys are
  locked asks the port to unlock for it, only when the attach would be honoured. While the terminal
  is handed over to another program, the composer's stdin proxy now forwards nothing.
- `@robota-sdk/agent-command` adds `/unlock` and `/lock` (`createKeyCustodyCommandModule`,
  `IKeyCustodyCommandPort`), user-only, registered by `createDefaultCommandModules` only when given a
  `keyCustodyPort`.
- `@robota-sdk/agent-framework`: `lockedSessionMessage` and `lockedSessionsNotice` take an optional
  `unlockCommand` and name it for locked keys, and `editCheckpointsLockedMessage` words a locked
  rewind the same way; without one the wording is unchanged. The TUI passes `/unlock` where it has
  the key custody, in the resume picker, Ctrl+R and fork attach; `/rewind`, `/validate-session`,
  `/agent read` and `/background read` name it where the session registered it.
- `@robota-sdk/agent-cli` composes the gate for the TUI in secure mode: the passphrase is asked on the
  secret terminal inside the terminal handoff, one question at a time, never where nobody can answer.

What to do: nothing.
