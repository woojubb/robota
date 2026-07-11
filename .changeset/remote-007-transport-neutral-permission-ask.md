---
'@robota-sdk/agent-interface-transport': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-transport-protocol': minor
'@robota-sdk/agent-transport-tui': patch
---

Make the permission and "ask the user" flows transport-neutral (REMOTE-007 / B4-2a). A session now
emits `permission_request` / `ask_request` / `prompt_resolved` events and exposes
`resolvePermission` / `resolveAsk`, so any attached surface — local TUI, a WS/WebRTC driver, or a web
UI — can render and answer the SAME prompt (local == remote). The framework builds event-emitting
default handlers bound to the session emitter (id-keyed parking, fail-closed on zero listeners / on
detach / backstop, teardown drain on abort/cancelQueue/shutdown), replacing the injected
askHandler/permissionHandler at their source. `getUserInteraction()` is gated on the `ask_request`
listener count so the headless "no-human ⇒ proceed" contract is preserved. The WS protocol carries the
new events + `permission-response` / `ask-response` verbs, and WebRTC gets them for free via the shared
handler. No `/remote-control` enable path is added.
