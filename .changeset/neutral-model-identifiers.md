---
'@robota-sdk/agent-framework': major
---

The framework now defaults to neutral model-facing identifiers: projected command tools use
`command_` and attached file content uses `<file_references>`. This changes the default output of
`MODEL_COMMAND_TOOL_PREFIX`, `createProviderSafeModelCommandToolName`,
`createModelCommandToolProjection`, and `buildPromptWithFileReferences` for SDK consumers.

To preserve the previous identifiers, pass `modelCommandToolPrefix: 'robota_command_'` and
`promptFileReferenceTag: 'robota_file_references'` in session options, or pass those values to
the projection and prompt-format helpers. The Robota product profile supplies both values, so
the Robota CLI keeps its existing model tool names and prompt enclosure.
