---
"@robota-sdk/agent-session": patch
---

On Windows, session-log sealing, prompt-history compaction and every other in-place rewrite no longer refuse every file as replaced between two looks: the file is confirmed by its file index, since a Windows path reports no device number. A prompt-history path that is a directory is now an error there, as it already was on Linux and macOS, instead of an empty history.
