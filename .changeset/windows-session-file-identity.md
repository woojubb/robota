---
"@robota-sdk/agent-session": patch
---

On Windows, session-log sealing, prompt-history compaction and every other in-place rewrite now work instead of refusing every file. The file is confirmed by its file index, since a Windows path reports no device number, and the replacement is made after the catch-up because Windows will not rename over an open file. A prompt-history path that is a directory is now an error there, as on Linux and macOS, instead of an empty history.
