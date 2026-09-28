---
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-interface-command': minor
'@robota-sdk/agent-cli': patch
---

`${CLAUDE_SKILL_DIR}` in a skill expands to the absolute folder its `SKILL.md` is in; it used to expand to an empty string. A skill's `` !`command` `` gets `CLAUDE_SKILL_DIR` and `CLAUDE_SESSION_ID` in its environment, so the shell expands them there too (`TShellExecFn` takes an optional `env`). Skills from host folders and a trusted project carry the folder, and bundle-plugin skills and commands record theirs. `ICommand` gains `skillDirectory`, and `IContributionSource` an optional `locate()` that names the absolute path of a root-relative one.
