---
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-interface-command': minor
---

`${CLAUDE_SKILL_DIR}` in a skill expands to the absolute folder its `SKILL.md` is in; it used to expand to an empty string. Skills from host folders, a trusted project and bundle plugins all carry it. `ICommand` gains `skillDirectory`, and `IContributionSource` an optional `locate()` that names the absolute path of a root-relative one.
