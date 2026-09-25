---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-cli': minor
---

A new permission mode, `auto`, lets a model classifier approve or block what would otherwise prompt.

- **What it decides:**
  - Reads and in-workspace edits run as in `acceptEdits`.
  - Commands and other calls the mode leaves open go to the classifier, a side call to the
    session's own model. It sees the call, the working directory and the git remotes, never the
    conversation.
  - A block reaches the model with its reason, so it can take another route.
- **What still reaches a person, or is refused:**
  - Deny rules and background ceilings apply first.
  - `ask` rules, critical removals and protected paths ask a person.
  - After 3 blocks in a row, or 20 in the session, the mode asks a person until one approves.
    With no one to ask, the call is denied.
- **Allow rules:** in `auto` mode, allow rules that approve any command are set aside while the
  mode is on. Examples are `Bash(*)`, an interpreter (`Bash(python *)`), a package runner
  (`Bash(npm run *)`) or `Agent`. Narrow rules still apply.
- **Retry:** `/permissions` lists classifier blocks. `/permissions retry <n>` lets that exact call
  run once, unjudged, when the model tries it again.
- **Turning it on and off:**
  - `--permission-mode auto`, `/mode auto` or `/permissions auto`.
  - An organization turns it off with `disableAutoMode` in the org policy.
- **New contracts:**
  - `TPermissionMode` gains `'auto'`.
  - `allowRulesForAutoMode` and `isBroadExecutionAllowRule`.
  - `IPermissionClassifier` and `AutoModeGate`.
  - The `permissionClassifier` session option.
  - `Session.retryPermissionDenial`, and `retryDenial` on the permission-mode adapter.
  - The `'classifier'` denial reason.
  - `createModelPermissionClassifier`.
  - The `disableAutoMode` option on `createSession` and `IOrgPolicy`.
