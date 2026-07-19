# Web-surface reorg (GUI-007) + loopback WS auth (SEC-001)

## STATUS: DONE — merged #1249 (2026-07-20)

GUI-007 (dissolve agent-web-monitor: monitor→packages/agent-cli-web CLI-served over localhost `--serve --open`; remote→apps/agent-web `/remote`; agent-transport-gui keeps transport name) + SEC-001 (auto-mint loopback token + Host/Origin 403-at-upgrade + fail-closed; token delivered via the served monitor `ws-url` `?token=`) BOTH implemented + gated (WRITE/APPROVAL/VERIFY/COMPLETE) + AGENT-RUN verified + merged. Review 1 SHOULD (malformed-URL DoS in serve-monitor-ui → try/catch 400) + CONSIDER (monitor Host guard) fixed. DEFERRED tracked: SEC-001 0600 connection file (no consumer — injection+env cover today), interactive-mode `--open`. Superseded branch `feat/sec-001-loopback-ws-auth` to delete. Distribution direction (single engine + layered CLI/GUI bundles, GUI .app ships `robota` shim) = separate future DIST spec, unwritten.

In-repo mirror (memory-mirroring rule) of the 2026-07-19 owner-steered web/GUI-surface + loopback-security
workstream. Host mirror: session memory `web-surface-and-sec001.md`.

## Direction (owner-approved)

- **Distribution:** unify at the ENGINE level (already done — one runtime; TUI/headless/serve/GUI over
  `buildRuntimeSession`/`startRuntimeHost`); keep DISTRIBUTION layered — a standalone headless `robota` CLI/engine
  (no Electron; CI/agents/servers) + a `Robota.app` GUI bundle that spawns the engine AND installs a `robota` PATH
  shim (VS Code `code` pattern). A single GUI-only app is rejected (headless/self-hosting can't take Electron);
  features live in the ENGINE, GUI is presentation. The CLI-shim/packaging piece = a separate future DIST spec.
- **`agent-transport-gui` keeps its `agent-transport-*` name** (transport family) even though it is the GUI
  component core, not a transport (owner constraint).

## GUI-007 (approved, spec-docs/todo/, INFRA)

Dissolve `apps/agent-web-monitor` (it conflated a CLI-served monitor `index.html` + a HOSTED Stage-D remote
`remote.html`): monitor SPA → `packages/agent-cli-web` (CLI-owned product-shell); **the CLI actually serves it
from localhost** (owner chose this — the only working monitor today is the deployed `apps/agent-web` `/monitor`
= public-page→localhost = the SEC-001 hole); hosted remote → `apps/agent-web` `/remote`; remove agent-web
`/monitor`. Independent architecture-auditor + proposal-reviewer gated it.

- **P1a DONE** (branch `feat/gui-007-web-surface-placement`, not merged): `packages/agent-cli-web` created +
  `copy-web-assets` repointed + Library-Neutrality-Rule names it the 3rd product-shell member. Non-breaking.
- **P1b REMAINING (security-adjacent):** wire the static serve in `agent-cli/src/modes/serve-mode.ts` — serve
  `dist/web` over localhost HTTP + `<meta name="ws-url">` injection (the SEC-001 token hook; later carries
  `?token=`) + `--open`. Needs the RESOLVED WS port exposed from WsTransport (bindWithRetry-internal today) +
  runtime asset-path resolution. Then P2/P3 (remote route, remove agent-web `/monitor`, docs, SEC-001 retarget).

## SEC-001 (approved, .agents/backlog/) — interconnected

Auto-mint default loopback WS token + Host/Origin 403-at-upgrade + fail-closed. P1 server core DONE on branch
`feat/sec-001-loopback-ws-auth` (15/15 tests). Its token-DELIVERY target IS GUI-007's CLI-served monitor. Owner
order: **GUI-007 P1 → SEC-001 remaining → GUI-007 P2/P3** = one "secure local monitor" flow.
