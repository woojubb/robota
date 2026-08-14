---
'@robota-sdk/agent-interface-transport': major
'@robota-sdk/agent-transport': major
'@robota-sdk/agent-framework': major
'@robota-sdk/agent-transport-http': major
'@robota-sdk/agent-transport-mcp': major
'@robota-sdk/agent-transport-ws': major
'@robota-sdk/agent-transport-webrtc': major
'@robota-sdk/agent-transport-tui': major
'@robota-sdk/agent-cli': patch
---

**ARCH-011: replace the ambiguous transport lifecycle stub with executable conformance.**

`ITransportAdapter` now requires a frozen `service | runner` lifecycle descriptor. `start()` resolves
at the concrete transport's documented readiness boundary; start before attach and repeated active
start reject a stable lifecycle error, repeated stop is safe, and stopped adapters can reattach and
restart.

Runner adapters launch separately and expose a typed terminal outcome through
`waitForCompletion()`. The registry accepts base adapters, rejects duplicate names, keeps
configuration as an optional capability, returns complete ordered records whose pending slots become
registry-owned `abandoned` outcomes on stop/rollback, and exposes a real-runner-only first-failure
wait. It serializes startup/stop, rejects active restart before mutation, and reverses partial startup
from the currently failing adapter with typed safe rollback details. Runtime host and serve mode
propagate real nonzero runner results without treating normal shutdown abandonment as failure.

HTTP, MCP, both WebSocket adapters, WebRTC, and headless invoke one shared public conformance kit.
The former `TuiTransport` export is removed because it ignored the attached session; use `renderApp`
or `TuiInteractionChannel`, which honestly own their session lifecycle.
