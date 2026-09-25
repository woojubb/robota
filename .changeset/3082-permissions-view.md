---
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-cli': minor
---

`/permissions` shows the rules the session enforces and the calls it refused.

- **Rules by source:** each allow, deny and ask rule the gate reads is listed under the settings file
  that declares it. Rules added by a CLI flag, a preset or a command are listed under "this session".
  A rule a settings file declares but the session does not enforce is not shown.
- **Recent denials:** the latest refused calls, most recent first, with the reason: a rule or the
  mode, the user declining, or no one available to approve.
- New contracts: `Session.getRecentPermissionDenials()`, `PermissionEnforcer.getRecentDenials()`,
  `IPermissionDenial`, the `permissionRules` host adapter (`createSettingsPermissionRulesAdapter`),
  and `getPermissionRules` / `listRecentDenials` on `ICommandPermissionModeAdapter`. Settings
  provenance now covers `permissions.ask`.
