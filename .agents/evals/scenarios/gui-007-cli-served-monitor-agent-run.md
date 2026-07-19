# GUI-007 — the CLI serves its own web monitor over localhost (agent-run)

**Spec:** GUI-007 (web-surface placement — the CLI OWNS and SERVES its monitor SPA). TC-06/TC-07.
**Type:** agent-executable (the agent builds + runs the real CLI; no owner action).

Before GUI-007, the monitor SPA was copied into `agent-cli/dist/web` but **nothing served it at runtime** — the
only working browser monitor was the DEPLOYED `apps/agent-web` `/monitor` page reaching into `localhost:7070`
(the SEC-001 "any web page → loopback" hole). GUI-007 P1 wires a localhost-only static host in the CLI
`--serve` path, gated on `--open`, that serves `packages/agent-cli-web`'s built SPA and injects the live
`ws-url` — a **localhost-origin** monitor, the secure replacement.

## Scenario

```bash
pnpm --filter @robota-sdk/agent-cli build      # builds agent-cli-web → copy-web-assets → tsdown
node packages/agent-cli/bin/robota.cjs --serve --open
```

**Expected:** the CLI prints `Web monitor: http://127.0.0.1:<port>`; that page is `agent-cli-web`'s monitor
SPA with a server-injected `<meta name="ws-url" content="ws://127.0.0.1:<wsPort>">` pointing at the live WS.

## Observed (2026-07-20)

```
Using anthropic (claude-sonnet-4-6) via ANTHROPIC_API_KEY — ...
Web monitor: http://127.0.0.1:32829

$ curl -s http://127.0.0.1:32829/ | grep ws-url
<meta name="ws-url" content="ws://127.0.0.1:7070" />

$ curl -o /dev/null -w '%{http_code}' http://127.0.0.1:32829/index.html
200
```

✅ PASS — the CLI serves its own monitor from a loopback HTTP host, with the live WS URL injected. This is the
token-delivery channel SEC-001 will ride (`?token=` in the injected URL). Without `--open`, no monitor server
starts (the GUI-002 sidecar `--serve` path is unaffected).

## Unit coverage

- `packages/agent-cli/src/modes/__tests__/serve-monitor-ui.test.ts` — ws-url meta injection, static asset
  serving, 404, path-traversal reject (403, raw path), loopback-only bind (5 tests).
- `packages/agent-transport-ws/src/__tests__/ws-transport.test.ts` — `WsTransport.boundPort` after start.
