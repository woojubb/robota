---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-session': patch
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-command': patch
---

Fix `ConfigurationError: Agent must be fully initialized before changing model configuration` when running `/preset` (or any live model re-apply) on a fresh interactive session before the first message. The Robota agent initialized lazily on the first `run()`, but `setModel` requires full initialization. `Session.applyModelOptions` now awaits the new idempotent `Robota.ensureReady()` before `setModel`, and the preset live-switch path (`applyPresetToSession` → `executePresetCommand`) is async end-to-end. Adds a real cold-session regression test (no mocked Robota).
