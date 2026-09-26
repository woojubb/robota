---
'@robota-sdk/agent-transport-webrtc': patch
'@robota-sdk/agent-cli': patch
---

The embedded TURN relay says why it cannot listen — the port is taken, the host is not an address of
this machine, or the port needs privileges — and keeps the bind error as `cause`; the CLI names the
relay setting that cause asks you to change. Mesh options are no longer checked while
`transports.mesh.enabled` is off, so a mistake in them does not report that the mesh could not start.
