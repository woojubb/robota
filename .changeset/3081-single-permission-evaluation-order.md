---
'@robota-sdk/agent-core': major
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': major
'@robota-sdk/agent-subagent-runner': patch
'@robota-sdk/agent-cli': minor
---

One permission evaluation order for every caller. The interactive session, background tasks and
subagents used to run two different resolvers, so the same call could be decided differently
depending on who made it. They now share `evaluatePermission`, and a background policy only adds a
ceiling, an ask-everything flag and the task's own lists to it:

deny → caller ceiling → unevaluable deny (ask) → never-auto-approve set (ask) → ask-everything →
bypassPermissions → allow → mode.

- **`ask` rules.** `permissions.ask` patterns always ask, in every mode including
  `bypassPermissions`. They are matched per command like a deny rule, and are validated at
  construction alongside `allow` and `deny`.
- **Never auto-approved, bypass included:** removing a critical path with `rm`/`rmdir` (the root, a
  top-level directory, home, the working directory or a parent), and a modify-class write into
  `.git`, `.robota`, `.claude`, `.agents`, `.mcp.json`, `.gitconfig`, `.npmrc` or a shell rc file.
  Files inside an isolated worktree (`.robota/worktrees/<name>/…`) are ordinary files. With no
  approver attached, an ask is a denial.
- **A ceiling is checked before bypass and before any ask.** A subagent's `inherit-allowlist` ceiling
  is now the parent's *effective* rules, read live at spawn: settings, preset lists and command
  auto-allows. It used to be the raw settings file. An unevaluable deny under a policy now asks,
  like everywhere else, where it used to deny outright; with no approver it is still a denial.
- **Settings layers union `permissions.allow`**, as they already did `deny`. A checked-in project
  file no longer silently discards the user's allow list.
- **Print mode, `createQuery()` and headless sessions default to `default` mode**, not
  `bypassPermissions`. They have no approver, so a call that would ask is denied. Pass
  `--permission-mode` / `permissionMode: 'bypassPermissions'` explicitly for unattended runs.

**Breaking:**
- `@robota-sdk/agent-core` removes `resolvePermissionByPolicy` and `TPermissionPolicyDecision` in
  favour of `projectPermissionPolicy` plus `evaluatePermission`'s new `context` argument.
- `@robota-sdk/agent-framework` changes the settings merge rule for `permissions.allow`, and the
  default permission mode of `createQuery()` and headless sessions.
