---
'@robota-sdk/agent-transport-webrtc': patch
'@robota-sdk/agent-cli': patch
---

Device mesh discovery holds up better against endpoints and peers that misbehave.

- A direct path's admission deadline starts only from a `hello`, `offer` or `answer`, so ICE candidates
  that trail an admitted connection no longer set a working path aside.
- An endpoint or signaling carrier that keeps failing is set aside for longer each time it fails
  again, until a connection over it is admitted.
- An mDNS lookup keeps listening briefly after the first matching answer, so a faster answer from
  another host cannot hide the peer's own.
- The device lists read from public records are bounded per paired device, each device's newest
  before any device's next, and the chunks of one list carry a shared version, so a read that finds
  chunks of two versions yields no list. Records written before this change are not read as lists.
- CLI processes that share `~/.robota/devices/address-cache.json` apply each change to the file as it
  is on disk, so one process no longer overwrites what another learned.
