---
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-interface-analytics': minor
'@robota-sdk/agent-session-analytics': patch
'@robota-sdk/agent-framework': patch
---

A supervised session accepts attach connections on its control socket.

- A terminal of the same user sends `{"command":"attach","id","generation","mode":"drive"|"observe","protocol":1}`.
  The session compares the generation with its own. It refuses another generation, an unknown mode or
  protocol, or a fifth concurrent attach. Otherwise it answers `{"status":"attached","driverId":"attach:<n>"}`
  and carries the ordinary session protocol as newline-delimited JSON on the same connection.
- The driver id is assigned by the session and a client-sent one is ignored. Turns submitted from an
  attached terminal are attributed to it and counted under the new `attach` usage surface.
- `drive` sends prompts and answers the session's questions under the usual co-drive rules. `observe`
  is read-only and never counts as a surface that can answer, so an unattended session still denies
  its prompts at once.
- Detaching or crashing ends only that connection: a turn in progress keeps running, a prompt no other
  surface can answer is denied, and the session returns to its unattached posture. A reader that falls
  1 MiB behind is disconnected, and an oversize frame closes only its own connection. Stopping the
  session ends attached connections with it.
- Commands from an attached terminal carry the remote origin, so pairing, revoking and reading the
  pairing link stay refused. An attached terminal is never an operator approver; supervised sessions
  keep refusing mesh connections that need one.
- A client may send its first frames in the same write as the handshake; only the handshake line
  itself is held to the control endpoint's line limit.
- `agent-framework`: the surface a turn was submitted on now reaches its usage observation. It was
  dropped before, so remote-control turns were counted as `unknown`.
- The terminal client (`robota session attach`) and the view keys come separately.
