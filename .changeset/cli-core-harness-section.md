---
'@robota-sdk/agent-cli': patch
---

The core harness prompt is now a section of its own (`core-harness` in `/context prompt`) instead of the first part of the preset's system prompt, so a live `/preset` switch to a preset that carries its own system prompt no longer drops it for the rest of the session. The CLI also ships the SDK that asks the Anthropic API to cache the prompt of an agent loop and records what was read from the cache: a session with several model calls now reads most of its prompt from the cache instead of paying full price for it on every call.
