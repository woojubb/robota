# User Execution Scenarios — real-usage verification (agent-runnable)

These are the **real-usage scenarios** the owner would otherwise verify by hand. Per the owner principle
(a "user execution test" done-gate must be **agent-runnable** — the agent builds and runs the same scenario the
owner would, never deferring a manual smoke), each scenario is backed by an executable test that produces
inspectable evidence (a screenshot or captured console output).

Surfaces covered: the **desktop app** (agent-app / GUI over the shared runtime), the **headless runtime**
(`robota --serve`), and **remote control** (WebRTC P2P). All backing tests are green as of the last run.

| ID      | Scenario                                            | Surface                                   | Backing test                                               | Evidence                 |
| ------- | --------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------- | ------------------------ |
| S-GUI-1 | Chat with the agent in the desktop app              | agent-app (Electron)                      | `apps/agent-app/e2e/run-e2e.mjs` + `capture.mjs`           | `shots/conversation.png` |
| S-GUI-2 | Approve a tool the agent asks to run                | agent-app (Electron)                      | `apps/agent-app/e2e/run-e2e.mjs` + `capture.mjs`           | `shots/permission.png`   |
| S-SRV-1 | A client drives a turn over `robota --serve`        | agent-cli (headless runtime)              | `serve-mode.bintest.ts` TC-B                               | console (TC-B)           |
| S-SRV-2 | An unauthorized client is refused                   | agent-cli (headless runtime)              | `serve-mode.bintest.ts` TC-A                               | console (TC-A)           |
| S-SRV-3 | The runtime shuts down cleanly on SIGTERM           | agent-cli (headless runtime)              | `serve-mode.bintest.ts` TC-C                               | console (TC-C)           |
| S-RMT-1 | Pair a second device and drive the session          | agent-transport-webrtc / remote-signaling | `pairing-e2e.test.ts` + `integration-webrtc-relay.test.ts` | console                  |
| S-RMT-2 | A wrong pairing secret is rejected (fail-closed)    | agent-transport-webrtc                    | `pairing-e2e.test.ts`                                      | console                  |
| S-RMT-3 | Session content never transits the signaling server | remote-signaling                          | `relay-hardening.test.ts`                                  | console                  |

## Scenario details

### S-GUI-1 — Chat with the agent in the desktop app

1. Launch the built Electron app (headless under xvfb). It mints a per-launch loopback nonce and spawns its
   `robota --serve` sidecar, then connects over the token-gated loopback WS.
2. The header shows **connected**.
3. Type `Summarize the terminal-noir GUI shell.` and Send.
4. **Expect:** a `YOU` block with the message, then a streaming `AGENT` reply block.

### S-GUI-2 — Approve a tool the agent asks to run

1. From the connected app, send `please ask permission`.
2. The agent requests a gated tool.
3. **Expect:** a **Permission request** modal — "Allow `write_file` to run?" with **Allow** / **Deny**. Clicking
   **Allow** resolves the permission and the tool completes.

### S-SRV-1 / S-SRV-2 / S-SRV-3 — headless `robota --serve`

The real `robota --serve` binary is spawned with a loopback nonce (`ROBOTA_WS_TOKEN`/`ROBOTA_WS_PORT`) and a
deterministic replay provider (`--session-log`, no model key). Over the production WS protocol:

- **S-SRV-1 (TC-B):** an authenticated client submits `hello` → receives the recorded reply end-to-end.
- **S-SRV-2 (TC-A):** a connection with the wrong token is rejected **before any session data** is emitted.
- **S-SRV-3 (TC-C):** `SIGTERM` drives a graceful host shutdown (no SIGKILL / hang).

### S-RMT-1 / S-RMT-2 / S-RMT-3 — remote control (WebRTC P2P)

- **S-RMT-1:** a host (`WebRtcTransport` with a pairing secret) and a "second device" (werift answerer) reach the
  **real** signaling server via production `WsSignalingClient`, establish a **real** `RTCDataChannel`, and
  round-trip a session message over it. Matching secrets → session exposed.
- **S-RMT-2:** mismatched secrets → both peers reject and the session is **never exposed** (fail-closed).
- **S-RMT-3:** the signaling relay forwards **only** `{signal: offer/answer/ice}` frames and holds no session
  content — the session payload rides the P2P data channel only, never the signaling server.

## How to run (agent-runnable)

```bash
# GUI (real Electron under xvfb) — writes screenshots to e2e/shots/
pnpm --filter @robota-sdk/agent-app test:e2e
( cd apps/agent-app && xvfb-run -a -s '-screen 0 1280x900x24' node e2e/capture.mjs )

# Headless runtime (robota --serve) black-box
pnpm --filter @robota-sdk/agent-cli test:bin   # serve-mode.bintest.ts (+ cross-fidelity)

# Remote control (WebRTC P2P)
pnpm --filter @robota-sdk/agent-transport-webrtc exec vitest run src/__tests__/pairing-e2e.test.ts
pnpm --filter @robota-sdk/remote-signaling exec vitest run \
  src/__tests__/integration-webrtc-relay.test.ts src/__tests__/relay-hardening.test.ts
```
