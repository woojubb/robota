---
'@robota-sdk/agent-framework': major
---

The framework now defaults to neutral model-facing identifiers: projected command tools use
`command_` and attached file content uses `<file_references>`. This changes the default output of
`MODEL_COMMAND_TOOL_PREFIX`, `createProviderSafeModelCommandToolName`,
`createModelCommandToolProjection`, and `buildPromptWithFileReferences` for SDK consumers.

To preserve the previous identifiers, pass `modelCommandToolPrefix: '<configured-tool-prefix>_command_'` and
`promptFileReferenceTag: '<configured-file-reference-tag>'` in session options, or pass those values to
the projection and prompt-format helpers. The product profile supplies both values, so
the configured CLI keeps its existing model tool names and prompt enclosure.
