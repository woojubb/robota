---
title: Devices, Peers and Remote Control
description: Message and send files between your Robota sessions, link your own computers into a device mesh, hand a conversation to another session or machine, and co-drive a session from a browser.
---

# Devices, Peers and Remote Control

Robota sessions can reach each other. Sessions of yours running on the same machine find each other
automatically; with the **device mesh** turned on, sessions on your other computers join them. From a
session you can then message another one, send it a file, or hand the whole conversation over to it.
Separately, **remote control** pairs a browser page with one session so you can co-drive it from
another device, such as a phone.

| Feature        | What connects                                                          | Commands                         | Needs                                                             |
| -------------- | ---------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------- |
| Local peers    | Your live Robota sessions on this machine                              | `/peers`, `/handoff`             | Nothing to set up                                                 |
| Device mesh    | Robota on your other computers, linked by one device identity of yours | `/devices`, `/peers`, `/handoff` | A device identity on each computer, and `transports.mesh.enabled` |
| Remote control | A browser page co-driving one session                                  | `/remote-control`                | A signaling relay and a hosted browser page, both run by you      |

The device mesh links only **your own** devices: one identity, created once, certifies each computer
you enrol. It is not a way to share a session with another person.

## Prerequisites

- The `robota` CLI installed on every computer involved — see [Getting Started](../getting-started/README.md).
- An **interactive terminal**. `/devices`, `/peers`, `/handoff` and `/remote-control` are commands for
  the person at the host terminal: the model cannot run them, and every secret (recovery phrase,
  enrollment code) is typed and shown only on that terminal.
- For enrolling devices and for remote control: a **signaling relay** you run yourself
  ([`apps/remote-signaling`](../../apps/remote-signaling/docs/README.md) in this repository), set as
  `transports.webrtc.options.relayUrl` in `~/.robota/settings.json`.
- For remote control only: the browser client page hosted somewhere you control (the `/remote` route
  of [`apps/agent-web`](../../apps/agent-web/docs/DEPLOYMENT.md)), set as
  `transports.webrtc.options.clientUrl`.

All `transports.*` settings in this guide are read from `~/.robota/settings.json` only. A project's
settings cannot turn on the mesh or remote control.

## Talk to another session on this machine

Start two `robota` sessions. In either one:

```text
/peers
```

`/peers` lists the other live sessions with their id, name, status (`working`, `needs input`,
`idle`) and how their workspace relates to yours (same worktree, same repo, different repo, or
unknown), followed by any linked devices. Then:

```text
/peers send <session-id> Can you run the integration tests on your branch?
/peers send-file <session-id> ./report.md
```

The receiving session treats the message as a turn from an untrusted third party (see
[Security model](#security-model)). Its model answers only through the `peer_reply` tool, which asks
its operator by default, showing the full text and the destination. A file you send is offered to the
receiving operator, who must accept it; it is kept aside and never run.

## Link your computers into a device mesh

1. **On your first computer only**, create your device identity:

   ```text
   /devices init laptop
   ```

   The terminal shows a 24-word recovery phrase **once** and asks you to retype three of its words,
   then offers an optional passphrase. Write the phrase down and keep it offline: with the
   passphrase, it is the only way to recover the identity. Do not run `init` on your other computers —
   there it creates a separate identity that can never link to the first.

2. **On each computer**, turn the mesh on and point at your relay in `~/.robota/settings.json`:

   ```json
   {
     "transports": {
       "mesh": { "enabled": true },
       "webrtc": { "options": { "relayUrl": "wss://relay.example.com" } }
     }
   }
   ```

   Restart `robota`. The mesh opens when an interactive session starts; print and serve runs never
   open it.

3. **Enrol the second computer.** On the first one:

   ```text
   /devices add
   ```

   It shows a one-time code, valid once for five minutes. On the new computer:

   ```text
   /devices join desktop
   ```

   and type the code **at the prompt** — never as an argument, where shell history would keep it.
   Both terminals then show the same six digits; compare them and confirm on both. Only then is the
   new device certified.

4. Check the result on either computer:

   ```text
   /devices
   ```

   It lists your devices, which one holds the signing key, certificate expiry, and the mesh status:
   whether it is on, how this device finds the others, and which are linked now.

Linked devices then appear in `/peers` and `/handoff`, and `/peers send` and `/peers send-file` take
a device id in place of a session id.

## Hand a conversation to another session or machine

```text
/handoff
/handoff <session-or-device-id>
```

With no argument, `/handoff` lists where the conversation can go. With a target, it first shows what
does **not** travel — uncommitted changes in the working tree and running processes stay on this
machine, and the destination uses its own provider credential — and asks you to confirm. The
receiving operator must also accept. The conversation arrives **saved, not started**; resume it there
with `robota --resume <id>`. This session ends once the destination confirms it saved the session;
until then the session stays here. If the confirmation is lost, running `/handoff` to the same
target again resends the same transfer, which is not saved twice.

## Co-drive a session from a browser

Set both settings in `~/.robota/settings.json`:

```json
{
  "transports": {
    "webrtc": {
      "options": {
        "relayUrl": "wss://relay.example.com",
        "clientUrl": "https://robota.example.com/remote"
      }
    }
  }
}
```

Then, in the session:

```text
/remote-control
```

It prints a scannable QR code and a pairing link. Open the link on the other device. The browser
waits until you approve the connection on the host terminal; every connection is put to you there,
including one from a device that paired before, and without an interactive terminal it is refused.
Once approved, the browser sends prompts and answers the session's questions alongside the host
terminal.

A paired browser is remembered in `~/.robota/remote-trusted-devices.json` so it can reconnect
without a new pairing link (still with your approval each time). List and remove them with
`/remote-control devices` and `/remote-control revoke <device-id>`. `/remote-control stop` ends
remote control.

## Reference

### Slash commands

| Command                                       | What it does                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `/peers`                                      | List other live sessions on this machine and linked devices.                                                 |
| `/peers send <id> <message>`                  | Send a message to a session or linked device.                                                                |
| `/peers send-file <id> <path>`                | Send a copy of a file you can read. The receiving operator must accept it.                                   |
| `/handoff [id]`                               | List destinations, or push this conversation to one after confirming what stays behind.                      |
| `/devices` or `/devices list`                 | List your devices and the mesh status.                                                                       |
| `/devices init [name]`                        | Create your device identity and recovery phrase. First device only.                                          |
| `/devices add`                                | Show a one-time code to enrol another device (needs the signing key).                                        |
| `/devices join [name]`                        | On a new device, join your devices with the code another device shows.                                       |
| `/devices revoke <device-id>`                 | Revoke a device (needs the signing key; a unique prefix of the id is enough). A device cannot revoke itself. |
| `/devices recover`                            | Rotate the signing key from your recovery phrase. Devices certified by a retired key must enrol again.       |
| `/remote-control` or `/remote-control enable` | Start remote control and show the pairing QR code and link.                                                  |
| `/remote-control status`                      | Show remote-control status and where the host key is stored.                                                 |
| `/remote-control devices`                     | List browsers trusted for reconnect.                                                                         |
| `/remote-control revoke <device-id>`          | Remove a trusted browser; it must pair again.                                                                |
| `/remote-control stop`                        | Stop remote control.                                                                                         |

A connected browser may run `/remote-control status` and `stop`; `enable` and `revoke` are refused
from it, and its status never shows the pairing link. `/devices` refuses anything but the host
terminal.

The model has two related tools: `peer_reply`, offered only in a turn a peer's message started, and
`peer_send_file`, which asks you on every call (no permission mode, rule or remembered answer
approves it), reaches only files inside the workspace that do not look like secrets, and is not
offered in a peer's turn.

### Settings

All keys live in `~/.robota/settings.json`.

| Key                                               | Default                                      | Meaning                                                                                                         |
| ------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `transports.mesh.enabled`                         | `false`                                      | Open the device mesh when an interactive session starts.                                                        |
| `transports.mesh.options.capabilities`            | `["file", "handoff", "message", "presence"]` | What a linked device may ask of this one. Also allowed: `delegate`, `drive`, `observe`.                         |
| `transports.mesh.options.dht`                     | `true`                                       | Use the BitTorrent Mainline DHT to find your devices.                                                           |
| `transports.mesh.options.pkarrRelays`             | built-in list                                | `https://` pkarr relays (at most 16), used when the DHT is off or cannot start.                                 |
| `transports.mesh.options.nostrRelays`             | built-in list                                | `wss://` Nostr relays (at most 16) for connection signaling; `[]` turns Nostr off.                              |
| `transports.mesh.options.relay.serve`             | `false`                                      | Run a TURN relay on this device for your other devices.                                                         |
| `transports.mesh.options.relay.port`              | `3478`                                       | Its port.                                                                                                       |
| `transports.mesh.options.relay.host`              | all interfaces                               | IPv4 address it binds.                                                                                          |
| `transports.mesh.options.relay.publicAddress`     | —                                            | IPv4 address your devices reach it at, when that is not one of this device's own.                               |
| `transports.mesh.options.relay.relayPorts`        | any free port                                | `{ "min", "max" }` (from 1024) for relayed addresses; behind a NAT, forward these and `port`.                   |
| `transports.mesh.options.relay.allowPrivatePeers` | `true`                                       | Whether the relay forwards into private and link-local ranges.                                                  |
| `transports.mesh.options.turnServers`             | `[]`                                         | Your own TURN servers, tried after your devices' relays. Each needs a `turn:` URL, `username` and `credential`. |
| `transports.mesh.options.relayOnly`               | `false`                                      | Use relayed connections only.                                                                                   |
| `transports.webrtc.options.relayUrl`              | —                                            | Your signaling relay. Required for `/devices add`/`join` and remote control; the mesh also uses it when set.    |
| `transports.webrtc.options.clientUrl`             | —                                            | The hosted browser page the remote-control pairing link opens. Without it, `/remote-control` refuses to start.  |
| `transports.webrtc.options.iceServers`            | —                                            | STUN/TURN servers for remote control: `{ "urls": "turn:…", "username", "credential" }`, one URL per entry.      |
| `transports.webrtc.options.forceTurn`             | `false`                                      | Remote control over TURN relays only; needs a TURN server in `iceServers`.                                      |

A malformed mesh setting stops the mesh with an error naming the setting; nothing is partly applied.
The mesh options are checked only while `enabled` is `true`. With the defaults, finding your devices
beyond the local network uses public infrastructure (the DHT and public Nostr relays); set `dht` to
`false` and `pkarrRelays` and `nostrRelays` to `[]` to rely only on the local network and your own
relay.

### Files and locations

| Path                                     | Contents                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| OS keychain, or `~/.robota/credentials/` | Private keys: device identity and the remote-control host key. `/devices init` names which one is used. |
| `~/.robota/devices/`                     | Device roster, certificates, revocation list and the address cache.                                     |
| `~/.robota/peer-files/<sender>/<name>`   | Files other sessions and devices sent you (mode `0600`, never executable).                              |
| `~/.robota/handoff/`                     | A handed-over session, staged until it is verified and saved.                                           |
| `~/.robota/remote-trusted-devices.json`  | Browsers trusted for remote-control reconnect.                                                          |

The keychain is used through the optional `@napi-rs/keyring` package (macOS Keychain, Windows
Credential Manager, Linux Secret Service); where no keychain works, keys go to an owner-only file
under `~/.robota/credentials`.

### Security model

- **A peer message carries no authority.** It becomes a turn under this session's own permission
  rules and mode, exactly like the session's own work — so it can still lead to tool calls those rules
  allow. The model is told, from the message's verified origin and never from its text, that the
  message comes from a peer and not from you. A message expands no `@path` references. Each sender is
  limited to 6 messages a minute and 30 an hour.
- **Files are data.** A received file is written without execute permission, never opened on
  arrival, and reaches the model only if something later reads it through the session's ordinary
  tools. The conversation is told only its name, size and SHA-256. Transfers are capped at 32 MiB and
  kept only when the whole content matches the offered hash.
- **The receiving operator decides.** Each incoming file and each incoming hand-off needs a yes on
  that machine's terminal every time, even when the capability is allowed; with no terminal the
  answer is no. `observe` and `drive` ask once per connection; `delegate` asks per request.
- **Credentials never travel.** A hand-off does not carry provider credentials; the destination uses
  its own.
- **Enrollment cannot be hijacked by the relay.** The new device proves the one-time code over the
  connection's DTLS fingerprints before anything else crosses, and the six digits both operators
  compare cannot be chosen by someone who only saw the code. The relay only forwards connection
  setup and never sees session content.
- **The recovery phrase is shown once and never stored.** Lose it (and its passphrase) and the
  identity cannot be recovered; revoke the lost device from one that holds the signing key instead.
- **Remote control is approved per connection** at the host terminal, a returning trusted browser
  included.

### Limitations

- The mesh links one user's devices only.
- Only one session per computer opens the mesh at a time; `/devices` in another session says so and
  it links nothing.
- The mesh opens only in interactive sessions, not in print mode, `--serve` or the daemon.
- Enrollment and anything touching the recovery phrase need an interactive terminal.
- An enrollment code works once, for five minutes, and stops working after too many failed attempts.
- `/remote-control` has no built-in relay or browser page: without `relayUrl` and `clientUrl` it
  refuses to start.
- An interrupted file transfer is discarded; there is no resume.

### Troubleshooting

| Message                                                                        | Fix                                                                                                                                                        |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Device mesh: off. Set transports.mesh.enabled to true in your user settings…` | Add the setting to `~/.robota/settings.json` and restart `robota`.                                                                                         |
| `This device has no identity yet…`                                             | On a second computer, use `/devices add` on the first and `/devices join` here — not `/devices init`.                                                      |
| `Enrolling a device needs a signaling relay…`                                  | Set `transports.webrtc.options.relayUrl` on both computers.                                                                                                |
| `No device accepted that code…`                                                | The code was wrong, expired or used. Run `/devices add` again for a new one.                                                                               |
| `This device does not hold the signing key.`                                   | Run `add` or `revoke` on the device that holds it (see `/devices`), or `/devices recover`.                                                                 |
| `The signing key on this device has expired.`                                  | Run `/devices recover`.                                                                                                                                    |
| `Remote control needs a signaling relay…` / `…needs a browser client page…`    | Set `relayUrl` / `clientUrl` under `transports.webrtc.options`.                                                                                            |
| `Local peer discovery is off for this session: …` (at startup)                 | The private rendezvous directory (`$XDG_RUNTIME_DIR/robota/peers`, else `~/.robota/peers`) is not usable; the message says why. Linked devices still work. |
| `This session has no hand-off carrier…`                                        | The session reaches neither other local sessions nor a device mesh — see the previous row, or turn on the mesh.                                            |
| `No other machine is reachable for a hand-off right now.`                      | Start the other session, or check `/devices` for linked devices.                                                                                           |

## Related

- [Sessions, background sessions and the daemon](./sessions-and-daemon.md)
- [MCP and external events](./mcp.md)
- [CLI reference](./cli.md)
- [Permissions and hooks](./permissions-and-hooks.md) — the rules a peer's turn runs under
- [`@robota-sdk/agent-interface-session-mobility` SPEC](../../packages/agent-interface-session-mobility/docs/SPEC.md) — how peer messages and hand-offs carry (no) authority
- [`@robota-sdk/agent-remote-pairing`](../../packages/agent-remote-pairing/docs/README.md) — device identity, enrollment and pairing
- [`@robota-sdk/agent-transport-webrtc`](../../packages/agent-transport-webrtc/docs/README.md) — the WebRTC transport and device mesh
- [Signaling relay](../../apps/remote-signaling/docs/README.md) and [browser client deployment](../../apps/agent-web/docs/DEPLOYMENT.md)
