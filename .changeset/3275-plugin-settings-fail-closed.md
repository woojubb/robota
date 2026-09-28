---
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-command': patch
---

A user settings file that does not parse no longer reads as "no plugin is disabled". Plugin settings
now refuse to read it: no plugin loads (skills, commands, hooks and themes alike), a plugin command
such as `/plugin enable` fails instead of rewriting the whole settings file with the plugin keys
alone, and `robota doctor` reports the plugin check as failed while still inspecting each installed
plugin. The CLI already refuses to start with such a file; this covers a session started later in
the same process.
