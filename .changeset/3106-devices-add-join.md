---
'@robota-sdk/agent-remote-pairing': minor
'@robota-sdk/agent-transport-webrtc': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-cli': minor
---

`/devices add` and `/devices join` enrol a new device into your devices.

- On a device that holds the signing key, `/devices add` shows a one-time code on the terminal. It
  works once, for five minutes.
- On the new device, `/devices join [name]` asks for the code on the terminal, creates the device's
  keys, and meets the other device through the signaling relay in
  `transports.webrtc.options.relayUrl`. Both devices need that setting.
- The new device proves the code over the WebRTC connection's DTLS fingerprints before anything else
  crosses, so a relay in the middle cannot enrol anyone.
- Both devices then show the same six digits, and both operators compare them and confirm. Someone
  who saw the code cannot choose the digits: the new device commits to its part before it sees the
  existing device's.
- Only when both operators say yes does the existing device certify the new one and issue a new
  roster. The new device keeps its identity only once the chain it receives verifies.
- A wrong, expired or already used code is refused. So is a code after a few failed attempts. When
  either operator declines, nothing is issued or kept.
- The code appears only on the two terminals. It never reaches history, transcripts or the model. A
  code typed as a command argument is refused. Both commands stay user-only and refuse remote
  surfaces.
- `agent-remote-pairing`: enrollment codes, the enrollment proof, the signed request with its
  commitment, the short authentication string and the frame decoder.
- `agent-transport-webrtc`: `dialEnrollment` and `listenForEnrollment` provide a data channel bound to
  the negotiated fingerprints.
