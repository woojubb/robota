---
'@robota-sdk/agent-cli': patch
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-ui-terminal': minor
---

`sandbox.autoAllowBashIfSandboxed` takes effect. The CLI confined shell commands in the OS sandbox,
but no session learned about the sandbox, so a confined command still asked for approval in the
terminal UI, a served runtime and MCP serve, and a print run with no one to approve it refused it.

- `agent-cli` (patch): a served session, and each session a daemon keeps live, receives the sandbox
  the shell tools run under.
- `agent-framework` (minor): `HeadlessInteractionChannel` takes a `sandboxClient` option and hands it
  to the session.
- `agent-ui-terminal` (minor): `renderApp` and `TuiInteractionChannel` take a `sandboxClient` option
  and hand it to each session they build.
