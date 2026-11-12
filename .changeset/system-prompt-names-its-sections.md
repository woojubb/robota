---
'@robota-sdk/agent-interface': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-product': minor
---

A session now stores the sections its system prompt was composed from, beside the prompt: each section's id, source and rendered length, in prompt order, plus a digest of the product's own harness text (`none` when a run carries none). `/context prompt` lists them with their sizes and `/context prompt <section-id>` prints one exactly as the model receives it. A prompt a caller supplied whole has no known composition and is reported as such, and a fork inherits its parent's sections with the prompt.

Breaking for code that wires a session by hand: the rebuilder returned from session assembly now returns `{ message, manifest }` instead of a string, `Session.updateSystemMessage` takes the manifest of the message it replaces (omit it and the session reports none), and `ICommandSessionRuntime` gains `getSystemMessage` and `getSystemPromptManifest`. The `careful-reviewer` preset no longer documents a verification loop that never existed; its `selfVerification` is a prompt directive.
