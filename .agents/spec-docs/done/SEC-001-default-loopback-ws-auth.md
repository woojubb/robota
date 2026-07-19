---
status: done
type: SECURITY
tags: [security, transport, websocket, loopback, auth, token, dns-rebinding, gui-002]
---

# SEC-001: authenticate the default (defaultEnabled) loopback WebSocket path

## Problem

`WsTransport` (`packages/agent-transport-ws/src/ws-transport-configurable.ts`) runs with
`defaultEnabled = true` and binds `new WebSocketServer({ server })` on `127.0.0.1:7070`. When **no token is
configured** (the default for the plain `agent-cli` TUI and `apps/agent-web`), every connection immediately
receives full session history + the execution-workspace snapshot and is wired to `createWsHandler`, which can
`submit`, `executeCommand`, and **answer permission/ask prompts**. Because a browser `WebSocket` handshake is
NOT gated by CORS, **any local process — or any web page open in any browser on the machine (incl. via DNS
rebinding) — can reach `ws://127.0.0.1:7070` and fully drive AND authorize a running session.** Since
permission-answering _is_ the authorization gate, this is a standing OWNER-PRINCIPLE exposure on the default
path.

GUI-002 added the mechanism to fix it (`IWsTransportConfig.token` → reject-before-emit, constant-time compare)
but deliberately left the default path open to avoid a behavior change to the existing TUI/web flows. SEC-001
decides and implements the default-path story.

## Prior Art Research

**Topic:** default-posture + hardening for a default-enabled loopback control server (`ws://127.0.0.1:7070`
that streams full session history and lets a client submit prompts, run commands, and _answer
permission/authorization prompts_ — reaching the socket == full control).

### References (product docs / advisories only)

- **Jupyter Server / Notebook — "Security in the Jupyter Server"** (the closest analogue: default-on loopback +
  arbitrary code execution + browser-reachable). Default auth = ON, token **auto-minted** and logged as a
  `?token=…` URL. Zero-config delivery: an auto-launched browser gets a one-time-token→cookie; co-located
  clients read a connection file (`jpserver-<pid>.json`, `jupyter server list`) from the runtime dir — the user
  never types a secret. Disabling (`c.ServerApp.token = ''`) is possible but "NOT RECOMMENDED". Defense-in-depth
  is a **Host-header check** (DNS-rebinding): non-local `Host` → 403 unless `allow_remote_access`;
  `local_hostnames` extends the allow-list; CORS separately via `allow_origin`. Token-via-XSS/CORS CVEs
  (e.g. CVE-2025-59842) show the token is necessary but not sufficient — origin/host isolation matters.
- **VS Code Remote Tunnels / LSP** — avoid the ambient listener entirely: tunnels make an **outbound** relay
  connection with account-bound device-code auth; LSP uses **stdio/IPC** (trust boundary = who spawned it).
- **Ollama** (`127.0.0.1:11434`, **no auth**, CORS allows loopback) — earned **CVE-2024-28224 (DNS rebinding)**:
  a malicious web page rebinds DNS to `127.0.0.1` and drives the API. NCC's fix: "validate the Host HTTP header
  server-side… for loopback services the whitelist should only contain localhost + reserved loopback
  addresses." Open-by-default + no Host check = a shipped CVE.
- **llama.cpp / LM Studio** — no-auth by default; bearer token is **opt-in** (`--api-key`), treated as an API
  server not a browser-first surface (no Origin/Host check documented).
- **webpack-dev-server `allowedHosts`** (+ Rails `config.hosts`, Django `ALLOWED_HOSTS`) — validate the **Host
  header** against `localhost`/`127.0.0.1` by default **specifically to prevent DNS rebinding**; `'all'` bypass
  is "NOT RECOMMENDED".

### Observed common pattern

1. Browser-reachable local control surfaces converge on **secure-by-default with an auto-minted token**
   (Jupyter), delivered so the user never types a secret; the open-by-default runtimes (Ollama) got a CVE.
2. **"localhost = safe" without a Host check is a repeatedly-shipped CVE** — the universal remedy is a
   server-side **Host/Origin allow-list restricted to loopback**, applied independently of any token.
3. The token and the origin check **defend against different attackers** (token stops a cross-origin/remote
   client that can't read the token file; Origin/Host stops browser DNS-rebinding/drive-by before auth), so
   mature surfaces ship **both**.

### Constraints for Robota

- This surface is **more dangerous than Jupyter/Ollama**: it exposes _answering authorization prompts_.
- WS handshakes aren't CORS-gated, so a browser will _open_ the connection regardless of page origin — BUT
  browsers **send an `Origin` header that page JS cannot forge**, making a server-side `Origin` allow-list
  unusually effective against the "any web page" threat, while a `Host` allow-list closes DNS rebinding.
- The **reject-before-emit token mechanism already exists** (`IWsTransportConfig.token`, constant-time compare).
- The two zero-config clients (TUI, `apps/agent-web`) are **co-located** with the server (same host/user) → the
  Jupyter runtime-file precedent applies directly.

Sources:

- Jupyter Server security — <https://jupyter-server.readthedocs.io/en/latest/operators/security.html>
- Jupyter Notebook security (6.5.2) — <https://jupyter-notebook.readthedocs.io/en/v6.5.2/security.html>
- Jupyter Notebook config (allow_remote_access / local_hostnames / allow_origin) —
  <https://jupyter-notebook.readthedocs.io/en/v6.5.2/config.html>
- VS Code Remote Tunnels — <https://code.visualstudio.com/docs/remote/tunnels>
- VS Code Language Server Extension Guide —
  <https://code.visualstudio.com/api/language-extensions/language-server-extension-guide>
- Ollama FAQ (bind address / OLLAMA_ORIGINS) — <https://docs.ollama.com/faq>
- NCC Group — Ollama DNS Rebinding (CVE-2024-28224) —
  <https://www.nccgroup.com/research-blog/technical-advisory-ollama-dns-rebinding-attack-cve-2024-28224/>
- llama.cpp server README (`--api-key`) — <https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md>
- webpack DevServer `allowedHosts` — <https://webpack.js.org/configuration/dev-server/>
- webpack-dev-server DNS rebinding (issue #887) — <https://github.com/webpack/webpack-dev-server/issues/887>

## Architecture Review

### Affected Scope

- `packages/agent-transport-ws` — the `WsTransport` server: token policy (auto-mint), reject-before-emit
  (exists), and the new mandatory `Host`/`Origin` loopback allow-list on the WS upgrade.
- `packages/agent-cli` — mints/obtains the token, writes the `0600` connection file, threads the token into the
  registered `WsTransport`, and prints the `?token=` URL.
- `apps/agent-web` (+ its serve path) — obtains the token at serve time (injected), not via a URL in history.
- `packages/agent-transport-gui` — GUI-002 already passes `ROBOTA_WS_TOKEN`; confirm it still composes.

### Alternatives Considered

- **Open-by-default + opt-in auth (Ollama model)** — simplest zero-config, but the documented anti-pattern
  (CVE-2024-28224); this surface also answers authorization prompts. REJECTED.
- **Origin/Host hardening only, no token** — stops browser drive-by/DNS-rebinding but not a non-browser local
  process that forges the `Origin` header; insufficient for an authorization surface. REJECTED as the _sole_
  control (adopted as a _second layer_).

### Decision (OWNER-APPROVED 2026-07-19)

Adopt the **Jupyter model + webpack/NCC Host+Origin loopback allow-list**:

1. **Secure-by-default, auto-mint the token.** When no token is configured, `WsTransport` generates a random
   per-launch token and requires it (reject-before-emit). `defaultEnabled` stays `true` — "enabled" now means
   "enabled _with_ auth." An explicit, discouraged opt-out (open) mirrors `c.ServerApp.token = ''`.
2. **Zero-config token delivery** via a `0600` connection file in the user runtime dir + serve-time injection
   for `apps/agent-web` + a printed `?token=` URL fallback. The user never types a secret. (The interactive
   terminal UI renders in-process and does NOT consume its own WS; the actual co-located readers are
   `apps/agent-web` `MonitorClient`, the GUI `SessionMonitor` — `ws-session-client.ts` takes a full `url`, so
   `?token=` embeds cleanly — and any future attach client.) NOTE the `?token=` URL fallback leaks the secret
   into shell history / server logs, so it is a fallback only — **serve-time injection is the primary path for
   the browser client** (mirrors why Jupyter moved to the one-time-token→cookie handshake).
3. **Mandatory `Host`/`Origin` loopback hardening** on the WS upgrade, independent of the token: reject any
   non-loopback `Host` (allow `localhost`/`127.0.0.1`/`::1` + a configurable list) to close DNS rebinding, and
   enforce an `Origin` allow-list (loopback + configured app origins) to close the browser drive-by hole
   before history is emitted. The reject MUST happen at the **upgrade handshake** (`verifyClient` / the raw
   `upgrade` handler → HTTP **403 before the 101 protocol switch**), NOT a post-connection `close()`. The
   `Host` match is **port-agnostic** (host portion only) because `bindWithRetry` can walk the port up to +20;
   the server binds **IPv4 loopback only**, so an inbound `[::1]` never connects (allowing `::1` is harmless
   but moot for inbound).
4. **Fail-closed (NO-FALLBACK-CRITICAL).** If the token cannot be minted, or the `0600` connection file cannot
   be written/delivered, the transport MUST keep auth **required** and surface an error (and/or print the
   `?token=` URL) — it MUST NEVER `catch → leave the port open`, which would silently reconstitute the exact
   vulnerability. A security failure fails closed, never open.

### Sequencing constraint (atomic delivery)

The auto-mint flip and the token DELIVERY to the current no-token consumers (`apps/agent-web` `MonitorClient`

- the GUI `SessionMonitor`) MUST land **together** — or auto-mint stays behind a flag until delivery ships —
  so no released build leaves a current no-token consumer rejected with `1008`. TC-06 (web/GUI injected-token
  proof) is part of the **same shippable unit** as the P1 auto-mint flip, not a later phase.

## Solution

(Design detail to be expanded into work units during implementation — commit-cadence.)

- **P1 — server + CLI mint/delivery (ONE shippable unit, per the sequencing constraint):** auto-mint token
  when none supplied (fail-closed on mint failure); add the `Host`/`Origin` loopback allow-list at the upgrade
  handshake (403-before-101, port-agnostic Host); expose the resolved token + an explicit `open`/opt-out flag
  on `IWsTransportConfig`; preserve GUI-002's explicit-token path; `agent-cli` writes the `0600` connection
  file (fail-closed on write failure) + threads the resolved token into the registered `WsTransport` + prints
  the `?token=` URL fallback. Ships behind a flag if web/GUI delivery is not yet wired, so no released build
  breaks a no-token consumer.
- **P2 — web/GUI delivery (co-shipped with P1 or the flag-flip):** `apps/agent-web` serve-time token injection
  into `MonitorClient` + the GUI `SessionMonitor` token wiring; finalize the `Origin` allow-list for the app
  origin. This is the delivery half of the atomic unit — the auto-mint default is only turned on for real once
  this lands.
- **P3 — docs + hardening finish:** security docs, the discouraged `open` opt-out doc, back-compat notes.

## Affected Files

- `packages/agent-transport-ws/src/ws-transport-configurable.ts` (+ tests)
- `packages/agent-cli/src/cli.ts` / transport-registry wiring + a connection-file writer
- `apps/agent-web` serve path
- `packages/agent-transport-ws/docs/SPEC.md`, security docs

## Completion Criteria

- TC-01 — no-token default: `WsTransport` binds with an auto-minted token; an unauthenticated connection is
  rejected before any history/workspace event is emitted (unit).
- TC-02 — `Host` allow-list: a non-loopback `Host` on the upgrade is rejected at the handshake (403 before the
  101), and a loopback `Host` on a walked-up (dynamic) port is accepted (port-agnostic match) (unit).
- TC-03 — `Origin` allow-list: a non-allowed `Origin` is rejected at the handshake; a loopback/configured
  origin is accepted (unit).
- TC-04 — token delivery: `agent-cli` writes a `0600` connection file and the co-located client authenticates
  from it with no user input (functional).
- TC-05 — explicit opt-out: the discouraged `open` flag restores unauthenticated behavior (unit) and is
  documented as not-recommended.
- TC-06 — back-compat + atomic delivery (SAME shippable unit as the P1 auto-mint flip): GUI-002's explicit
  `ROBOTA_WS_TOKEN` path still authenticates; `apps/agent-web` `MonitorClient` + the GUI `SessionMonitor`
  connect via the injected token (no released build leaves either rejected).
- TC-07 (AGENT-RUN) — the agent itself drives the real CLI: an unauthenticated `ws://127.0.0.1:7070` probe is
  rejected, and the co-located client (reading the connection file) succeeds; evidence saved under
  `.agents/evals/scenarios/`.
- TC-08 — fail-closed (NO-FALLBACK): when token minting or the `0600` file write fails, the transport keeps
  auth REQUIRED (an unauthenticated probe is still rejected) and surfaces the error — it never reverts to open
  (unit, fault-injected).

## Test Plan

Unit tests in `agent-transport-ws` (token auto-mint + reject-before-emit + Host/Origin allow-list, extending
`ws-transport-auth.test.ts`); a functional connection-file round-trip; the AGENT-RUN scenario driving the real
`robota` serve path.

## Tasks

- [ ] P1 server + CLI mint/delivery (auto-mint fail-closed + Host/Origin 403-at-upgrade + 0600 connection
      file), behind a flag until web/GUI delivery lands (TC-01/02/03/04/05/08)
- [ ] P2 web/GUI delivery (apps/agent-web serve-time injection + GUI SessionMonitor token) — co-shipped with
      P1 flip (TC-06, atomic)
- [ ] P3 docs + hardening finish
- [ ] AGENT-RUN verification (TC-07)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-19

- Prior Art Research: PRESENT + substantiated (10 documentation citations; default-on browser-reachable loopback
  control servers — Jupyter secure-by-default vs Ollama open-by-default CVE; webpack/NCC Host/Origin lesson) →
  `scan-spec-research` green.
- Frontmatter (`status`/`type: SECURITY`/`tags`): `check-spec-doc-frontmatter` green.
- Owner decision on the primary open question (default posture): **Secure-by-default auto-mint token**
  (AskUserQuestion, 2026-07-19) — the standing owner sign-off for the posture; the remaining sub-decisions
  (token delivery = `0600` connection file + serve-time injection; mandatory Host/Origin hardening) follow the
  prior-art recommendation.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-19

Independent `proposal-reviewer`: **REVISE → resolved**. The reviewer ENDORSED the direction (secure-by-default
auto-mint + `0600` connection-file delivery + mandatory Host/Origin hardening is "the correct security
posture, well-grounded in prior art"), verified all load-bearing premises against the actual code
(`ws-transport-configurable.ts` reject-before-emit + constant-time compare exists; `apps/agent-web`
`MonitorClient` + GUI monitor connect no-token today; GUI-002 `ROBOTA_WS_TOKEN` composes with auto-mint), and
confirmed rule alignment (OWNER-PRINCIPLE local==remote authorization — the core justification; api-boundary;
research-first). REVISE was for 5 additive spec strengthenings, ALL now applied:

1. **Fail-closed clause + TC-08** (no-fallback-critical): mint/file-write failure keeps auth REQUIRED, never
   reverts to open. — Added to Decision (#4) + TC-08.
2. **Atomic delivery sequencing**: auto-mint flip + web/GUI token delivery ship together (or auto-mint behind a
   flag until delivery lands). — Added as the Sequencing Constraint; P1/P2 restructured into the shippable
   unit; TC-06 tightened.
3. **Host/Origin reject at the upgrade handshake (403 before 101), port-agnostic Host** (dynamic port via
   `bindWithRetry`), IPv4-loopback note. — Added to Decision (#3) + TC-02.
4. **Fixed "TUI reads it" wording** → named the real co-located readers (`apps/agent-web`, GUI `SessionMonitor`,
   future attach clients; the interactive terminal UI is in-process). — Decision (#2).
5. **`?token=` URL-fallback leak caveat** (shell history / logs; serve-time injection is primary). — Decision (#2).

Owner posture sign-off captured at GATE-WRITE. Decision + additions endorsed → **approved**.

### [GATE-IMPLEMENT] — in progress (integrated with GUI-007, branch `feat/gui-007-web-surface-placement`)

Implemented on the GUI-007 branch (the two specs interconnect — GUI-007's CLI-served monitor IS SEC-001's
token-delivery surface; the earlier standalone `feat/sec-001-loopback-ws-auth` P1 commit is superseded by this
integration):

- **Server core DONE** (`ws-transport-configurable.ts`): auto-mint token when no explicit token & not `open`
  (`resolvedToken` getter; explicit token wins; `open:true` opt-out); **fail-closed** (mint throw → constructor
  throws → never binds open); **Host/Origin 403-at-upgrade** via `verifyClient` (non-loopback Host port-agnostic
  reject = DNS-rebinding; browser Origin allow-list; non-browser omits Origin → token-gated); `allowedHosts`/
  `allowedOrigins`. Coexists with GUI-007's `boundPort`. Tests `ws-transport-auth.test.ts` 10 (+ 5 in `ws-transport.test.ts` = 15 package tests) (TC-01/02/03/05
  - GUI-002 token). Typecheck + no-fallback + no-fake green.
- **Delivery DONE (via GUI-007 serve):** `agent-cli --serve --open` injects the resolved token into the served
  monitor's `ws-url` (`?token=…`) — zero-config auth for the CLI's own localhost-origin monitor. GUI path
  unchanged (explicit `ROBOTA_WS_TOKEN`). AGENT-RUN verified — the served `index.html` carries
  `ws://127.0.0.1:<port>?token=<64-hex>`; the WS rejects unauthenticated (`1008`) and accepts the token (unit).
  Evidence `.agents/evals/scenarios/gui-007-cli-served-monitor-agent-run.md`.
- **DEFERRED:** the `0600` connection file (TC-04) — NO current consumer (the served monitor uses injection; the
  GUI uses the env token). Adding it now = forward-provisioning without a reader (the same smell the GUI-007
  review flagged for the copied-but-unserved bundle). Deferred until a standalone attach client exists; the two
  live delivery paths cover today's clients. TC-08 fail-closed is satisfied at the mint layer (auth never
  reverts to open).
- **Atomic-delivery constraint** honored WITHIN this branch: GUI-007 P2/P3 removes the deployed `apps/agent-web`
  `/monitor` (the public-page→localhost consumer that auto-mint would otherwise break) in the same effort, and
  the CLI-served monitor replaces it.

### [GATE-VERIFY] — ✅ PASS | 2026-07-20

- TC-01 (auto-mint, unauth rejected, token accepted), TC-02 (Host 403), TC-03 (Origin 403/allow), TC-05
  (`open` opt-out): `ws-transport-auth.test.ts` 10 (+ 5 in `ws-transport.test.ts` = 15 package tests).
- TC-04 (0600 connection file): **DEFERRED** — no consumer (served monitor uses ws-url injection, GUI uses
  the env token); adding it now = forward-provisioning without a reader. Re-open when a standalone attach
  client exists.
- TC-06 (AGENT-RUN): `robota --serve --open` delivers the token via the served monitor's `ws-url`
  (`?token=<64-hex>`); the WS rejects unauth (`1008`) and accepts the token. Evidence
  `.agents/evals/scenarios/gui-007-cli-served-monitor-agent-run.md`.
- TC-08 (fail-closed): satisfied at the mint layer — auth is REQUIRED by construction (auto-mint), never
  reverts to open; a `0600`-file failure is moot (deferred).
- Delivered integrated with GUI-007 (the CLI-served monitor is the token-delivery surface). Scans + typecheck
  green.

**GATE-COMPLETE pending** the PR review + merge-verify. Note the two DEFERRED items (0600 file, interactive-mode
`--open`) are tracked follow-ups, not gaps.

### [GATE-COMPLETE] — ✅ PASS | 2026-07-20

Server core + Host/Origin + fail-closed + token delivery (via the CLI-served monitor ws-url injection) done + AGENT-RUN verified. TC-04 (0600 file) + interactive --open DEFERRED as tracked follow-ups (no consumer today). Merged #1249. pr-review-reviewer 1 SHOULD (malformed-URL DoS) + CONSIDER (monitor Host guard) + 2 NIT all applied (`36f2cc6d6`); merge-verified on develop. Spec → `done/`.
