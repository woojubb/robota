---
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-ui-terminal': patch
'@robota-sdk/agent-cli': patch
---

One broken skill or agent file no longer stops the session.

Skill, command and agent definitions are shared with other hosts through `.claude`, and those hosts
define fields of their own. The frontmatter decoder now validates only the fields robota owns and
ignores the rest (nested `metadata` entries included); a malformed value of an owned field is still
refused. A refused file is skipped with a single warning and still claims its name, so a
lower-priority definition cannot stand in for it. An empty `argument-hint` reads as no hint. When
initialization does fail, the session reports the cause to readiness probes instead of "not
initialized", so the terminal shows the reason at once rather than a 15-second timeout.

The terminal also stops printing type names for message-less telemetry records, keeps its own notices
in place across a history sync so the following answer is not skipped, and CLI diagnostics print
their context instead of `[object Object]`, through the console so Ink renders them above the frame.
