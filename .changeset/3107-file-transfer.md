---
'@robota-sdk/agent-interface-session-mobility': minor
'@robota-sdk/agent-transport': minor
'@robota-sdk/agent-transport-webrtc': minor
'@robota-sdk/agent-remote-pairing': minor
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-cli': minor
---

Connected sessions can send each other files.

- `/peers send-file <session-id> <path>` sends a copy of any file the operator can read to another
  live session on this host.
- The model sends a file only through the `peer_send_file` tool. Every call asks the user, showing
  the path, size, hash and destination; no permission mode, rule or remembered consent answers it.
  The tool reaches only files inside the workspace whose path does not look like it holds secrets
  (`.env*`, `~/.ssh`, keys and credentials), and it does not exist in a turn a peer's message started.
- The receiving operator approves every file. A received file is kept as an inert copy (mode 0600)
  under `~/.robota/peer-files/<sender>/`. It is never run and never placed in the model's context.
  The conversation is told only its name, size and sha256. A name that leaves that directory is
  refused, a symbolic link is never written through, and nothing is overwritten.
- Transfers travel on a channel of their own (a separate connection on this host, a separate data
  channel between devices), in chunks the receiver paces, up to 32 MiB, and are kept only when the
  whole content matches the offered sha256. A transfer that ends early is discarded; there is no
  resume.

**API**

- `agent-interface-session-mobility`: the `file` capability, which asks the operator for every
  request; `ConnectionAuthority.authorizeFile`; `IFileOffer` and `IFileFrameChannel`.
- `agent-transport/node`: `sendFileOverChannel` and `receiveFileOverChannel`, the carrier over any
  `IFileFrameChannel`; `DEFAULT_MAX_FILE_BYTES`.
- `agent-transport-webrtc`: `IDeviceMeshLink.openFileChannel` and `onFileChannel`.
- `agent-remote-pairing`: `file` joins `DEVICE_CAPABILITIES`. A device certificate that names it is
  refused as malformed by an earlier version.
- `agent-core`: `IToolPermissionProfile.notInPeerTurn` withholds a tool from a turn a peer's message
  started.
- `agent-framework`: `ICommandLocalPeersAdapter.prepareFile`.
