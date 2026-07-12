# RUNTIME-001 — shared headless runtime surface (TUI · GUI as siblings)

Task file: [`.agents/spec-docs/active/RUNTIME-001-shared-headless-runtime-surface.md`](../spec-docs/active/RUNTIME-001-shared-headless-runtime-surface.md).
Owner-approved 2026-07-12 (verbatim: "Design A (권장)"). Placement independently proposal-reviewed (REVISE →
ENDORSED, 5 corrections applied). Directive: the GUI does not control the CLI (common-mistakes #79).

Design A: presentation-free, **ink-free** `startRuntimeHost()` factory + `robota --serve` headless entry in
`agent-cli`; lift `InteractiveSession` construction + the transport `startAll/stopAll` lifecycle out of
`TuiInteractionChannel` so the TUI path and `--serve` both sit over the one factory; point `apps/agent-app` at
`--serve` (removes the ink-in-a-pipe). Print (`-p`/`--goal`) stays a distinct autonomous surface (out of scope).
`packages/agent-runtime` = Phase-2.

## Tasks

- [x] T1: GATE-IMPLEMENT — task file + spec → active/, in-progress.
- [x] T2 (TC-01): Extract `startRuntimeHost()` into an **ink-free module** (NOT reached through `cli.ts`'s
      top-level `agent-transport-tui` import). It assembles the runtime block (preset → buildCommandSetup →
      transport registry + WsTransport → remote-control → provider → background/subagent runners → session
      store/resume, from `cli.ts:181-327`), **builds the `InteractiveSession`** (lifted from
      `TuiInteractionChannel.createSession()`), and **owns `transportRegistry.startAll/stopAll`** + stays alive
      until signaled. Returns a host handle (session + shutdown). Unit test with a scripted provider + stub
      registry; assert no `agent-transport-tui` in its module graph.
- [x] T3 (TC-02): Add the `robota --serve` headless entry (an ink-free entry module) that runs
      `startRuntimeHost`, serves the WS (token/port from env/flags), renders NO ink, shuts down cleanly on
      SIGTERM. Add `--serve` to `cli-args.ts`; dispatch to the serve entry BEFORE any ink import path.
- [x] T4 (TC-03): Refactor `TuiInteractionChannel` — no longer constructs its own `InteractiveSession` and no
      longer drives `startAll/stopAll` (host owns lifecycle); it receives an already-started session and renders
      over it (touch only via `interactiveSession` in wireSessionEvents/abort/shutdown/getSession). `startCli()`
      TUI path builds its session from the shared factory. Verify TUI teardown (`shutdownSessionBounded`) runs
      via the host stop path. tui-e2e + regression green; grep no second `new InteractiveSession(` in the channel.
- [x] T5 (TC-04): `apps/agent-app/electron/sidecar.ts` spawns `robota --serve` (extraArgs/command) — NOT the
      default ink branch. No renderer change. Run the headless Electron e2e (5/5) against the `--serve` sidecar
      (agent-owned) + confirm no ink rendered.
- [x] T6 (TC-05): dependency-direction (runtime surface presentation-free, no cycle); affected typecheck +
      tests + tui-e2e + agent-app e2e + `pnpm harness:scan` green; update `packages/agent-cli/docs/SPEC.md`
      (startRuntimeHost + --serve surface) + `.agents/project-structure.md` + arch-map; independent conformance
      audit.
- [ ] T7: feature→develop→main via merge-verifier; run tui-e2e + agent-app e2e myself (agent-owned).
- [ ] T8: GATE-COMPLETE — spec active→done; archive task + backlog; note GUI-003 can now bundle the `--serve`
      headless entry (not the full CLI).

## Test Plan

- **TC-01** (command): unit-test `startRuntimeHost` with a scripted provider + stub registry — session built,
  `startAll`/`stopAll` invoked, host handle returned; assert its module graph has no `agent-transport-tui`.
- **TC-02** (command/e2e): spawn `robota --serve` under a non-TTY with `ROBOTA_WS_TOKEN`/`PORT`; a WS client
  connects (nonce) + a turn round-trips + SIGTERM exits 0; assert zero ink output.
- **TC-03** (command): agent-cli + agent-transport-tui unit/regression + `tui-e2e` green; grep no second
  `new InteractiveSession(` in `TuiInteractionChannel`; TUI channel no longer calls `startAll/stopAll`.
- **TC-04** (headless e2e, agent-owned): `apps/agent-app` Playwright `_electron` e2e 5/5 against the `--serve`
  sidecar (not the ink branch); no ink in the sidecar output.
- **TC-05** (harness): affected typecheck + tests + `pnpm harness:scan` green; deps/conformance; SPEC + structure
  - arch-map updated.

## Implementation note (Design C, 2026-07-12)

Design A→B→C: two independent reviews rejected a new package; the runtime host was folded into
`agent-framework/src/runtime/` (next to createAgentRuntime) — correct layer, no new package/cycle. Per owner
directive (common-mistakes #80), the pre-existing duplication was RECONCILED: the TUI, print, and `--serve` all
build sessions via the single `buildRuntimeSession` seam; `startRuntimeHost` owns the transport lifecycle for
the headless path. TC-03 realized as the construction-seam SSOT (not a forced TUI lifecycle rewrite — the TUI
keeps its per-session-switch build+wire ordering, sharing the construction seam). Verified: framework 1088 +
transport 45 + transport-tui 418 + cli 203 tests; agent-app 12 + e2e 5/5; harness:scan 49/49.
