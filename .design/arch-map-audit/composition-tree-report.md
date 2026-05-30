# Audit Report: agent-cli/composition-tree.md

## Stale References

| Line | Current text               | Correct text     | Reason                                                            |
| ---- | -------------------------- | ---------------- | ----------------------------------------------------------------- |
| 26   | `agent-provider-anthropic` | `agent-provider` | All agent-provider-\* packages consolidated into `agent-provider` |
| 27   | `agent-provider-openai`    | `agent-provider` | All agent-provider-\* packages consolidated into `agent-provider` |
| 28   | `agent-provider-gemini`    | `agent-provider` | All agent-provider-\* packages consolidated into `agent-provider` |
| 29   | `agent-provider-gemma`     | `agent-provider` | All agent-provider-\* packages consolidated into `agent-provider` |
| 30   | `agent-provider-qwen`      | `agent-provider` | All agent-provider-\* packages consolidated into `agent-provider` |
| 31   | `agent-provider-deepseek`  | `agent-provider` | All agent-provider-\* packages consolidated into `agent-provider` |

## Correct References (no change needed)

- `agent-framework` (lines 18, 52, 54, 58): correctly reflects rename from `agent-sdk`
- `agent-command` (lines 24, 32, 69): correctly reflects consolidation of `agent-command-*`
- `agent-transport` (line 67): correctly reflects consolidated package
- `agent-transport/headless` (line 62): correct subpath
- `agent-transport/tui` (lines 68, 70, 71): correct subpath
- `agent-executor` (line 55): package name unchanged
- `agent-subagent-runner` (lines 56, 57): package name unchanged

## Missing References

- The `providerDefinitions` subtree (lines 26–31) lists 6 individual provider packages. After consolidation into `agent-provider`, the correct representation should show `agent-provider` once (possibly with internal sub-provider notes, not as separate packages). The current listing implies 6 separate packages still exist, which is misleading.

## Summary

The file is mostly up to date. The single category of stale references is the **provider sub-package listing** (lines 26–31): six separate `agent-provider-*` package names appear in the composition tree, but all have been consolidated into the single `agent-provider` package. These six entries should be collapsed into a single `agent-provider` reference (optionally annotating which providers are bundled inside it).

All other package names in the file (`agent-framework`, `agent-command`, `agent-transport`, `agent-transport/tui`, `agent-transport/headless`, `agent-executor`, `agent-subagent-runner`) are correct per the known renames.
