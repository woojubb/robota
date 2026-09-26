---
'@robota-sdk/agent-interface-session-mobility': minor
'@robota-sdk/agent-transport-webrtc': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-cli': minor
---

`/handoff` moves a session over a real connection.

- `/handoff <session-id>` pushes this conversation to another Robota session on this machine; the
  same carrier moves it between two of the user's devices over their mesh connection.
- A hand-off is push-only: only the operator of the session that holds it starts one. A session or
  device that asks another for its session is refused.
- The source signs a grant for that one transfer over that one channel with its device key, so a
  hand-off needs the device identity from `/devices init`. The receiving side checks it against the
  sender's certificate, then asks its own operator; without a yes nothing is sent.
- The session travels on the file-transfer carrier, is kept aside until it matches the manifest, and
  is saved without being started. The operator there resumes it with `robota --resume <id>`.
- The source gives the session up, and ends, only once the receiving side confirms it saved it.
  Every other outcome leaves the session where it was. Peer attribution (`driverId`, `turnSource`)
  travels with it.
- `/handoff` stays user-only. Its description tells the model to suggest the command to the user.
- `agent-transport-webrtc`: an admitted mesh link exposes the DTLS fingerprints it is bound to, and
  `judgeHandoffGrant` is exported.
- `agent-interface-session-mobility`: a hand-off carrier may move the sealed payload whole
  (`sendPayload`), the destination verifies it with `receivePayload`, and the source can report its
  open transfer (`status`) and abandon it for any refusal the destination names.
