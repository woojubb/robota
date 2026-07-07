---
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-cli': minor
---

Surface unmatched preset command-module names instead of silently dropping them (INFRA-032). A preset `enabledCommandModules`/`disabledCommandModules` entry that matches no built command module — a short form like `"editor"` instead of `agent-command-editor`, or a typo — is now reported as a non-fatal notice on both the startup `--preset` path (CLI terminal) and the in-session `/preset` path (command result). Detection lives once in agent-framework's new pure `findUnknownModuleNames`, and agent-command's duplicate module filter now delegates to the framework's `selectCommandModules`; `createDefaultCommandModules` returns `{ modules, unknownModuleNames }`.
