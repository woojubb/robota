---
"@robota-sdk/agent-core": patch
---

A cassette recorded with, or replayed into, a Windows workspace path now replays correctly. The replay used to splice the recorded and the replay path into serialized JSON as plain text: a Windows path made that JSON invalid, and a recorded Windows path was never found, so the tool calls kept their recorded location. Paths are now rewritten string by string, escaped where they sit inside a tool call's JSON arguments, and the staleness hash treats both spellings of a path alike.
