---
'@robota-sdk/agent-transport': patch
'@robota-sdk/agent-transport-ws': patch
'@robota-sdk/agent-transport-webrtc': patch
'@robota-sdk/agent-interface-command': patch
---

The wire protocol gained several request/reply pairs so a GUI never has to scrape command output for
data it can read directly.

`get-settings`/`update-settings` read and write the Settings screen; a patch applies through the same
function its matching slash command uses, so the two paths cannot drift. `list-models` returns the
configured models grouped by provider profile, with the current profile and model. `get-agent-definitions`
returns the agent switcher's roster and current selection. `project-status`, `project-diff` and
`project-memory` back the Project panel's git status, one file's diff, and project memory; a host
without this capability answers `protocol_error` instead of hanging. `rename-session` and
`delete-session` rename or remove a stored session from the list, current or not, each with its own
success/failure reply.

The `messages` frame gained an optional `display` field — the same history projected into display
segments (text runs and finished tool calls, diffs included) — and the connection's own `driverId`, so
a reload, reconnect or resume shows tool rows and tells a co-driver's turns from its own. The `error`
frame gained optional `code`, `provider`, `retryAfterSeconds` and `model` fields so a renderer can say
what kind of failure happened (`auth`, `rate_limit`, `model_unavailable`, `network`, `provider`) instead
of showing only raw text; a session error this classification does not recognize is unchanged.

`TCommandSurfaceLocality` names whether a `'remote'`-sourced command is provably on this machine. The
WebRTC/device-mesh transport now forwards `'remote'` for it (it proves no locality, the same rule
already applied to pairing), and both the WS and WebRTC transports forward it into the Settings
read/write path, so a command that refuses a remote surface (installing a plugin) refuses identically
regardless of which transport carried it.
