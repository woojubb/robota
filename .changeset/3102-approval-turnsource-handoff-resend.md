---
'@robota-sdk/agent-transport-webrtc-web': minor
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-session': patch
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-cli': patch
---

Follow-ups to connection approval and `/handoff`.

- `agent-transport-webrtc-web` — the browser remote client says `Waiting for the host to approve this connection…`
  (`awaiting-approval`) after pairing, and `Connected` only once the host's session answers. A host that closes the
  channel instead is shown as `refused` and is not retried, since a retry would only ask the operator again.
- `agent-core`, `agent-session`, `agent-framework` — a turn that did not come from the operator stores its
  `turnSource` (`peer`, `external`, `agent-wakeup`) beside `driverId` on the user message and in the display
  history (`IRunOptions.turnSource`), so a session handed off keeps where each turn came from.
- `agent-cli` — a `/handoff` resent after a lost confirmation reports what stays behind as it is now, not as it was
  at the first attempt, and after refusing to resend a session that changed, the hand-off status shows that refusal
  instead of the earlier lost confirmation.
