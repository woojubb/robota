---
status: in-progress
type: INFRA
tags: [runtime, architecture, cli, gui, headless, session, refactor]
---

# RUNTIME-001: shared headless runtime surface — TUI and GUI as sibling presentations

> Owner directive (common-mistakes #79): **the GUI does not control the CLI** — `agent-cli` (TUI) and
> `apps/agent-app` (GUI) must be sibling presentations over a shared runtime, not a control hierarchy. This
> spec extracts that shared runtime surface.

## Problem

The agent **runtime** (an `InteractiveSession` + its transports/providers/commands, run headlessly) has no
surface of its own. Two concrete consequences, both verified in the code:

1. **The desktop GUI's backend is a full ink TUI rendered into a pipe.** `apps/agent-app` spawns the `robota`
   CLI with a token+port in the env and **no argv flags** (`apps/agent-app/electron/sidecar.ts:51-68`,
   `main.ts:67-73`). There is **no `--web`/headless-serve flag and no `isTTY` gate** on the interactive branch,
   so the CLI falls through to the default interactive path and calls `renderApp(...)` (ink) at
   `packages/agent-cli/src/cli.ts:367`. The WebSocket the GUI actually needs is served only as a **side-effect**
   of the TUI channel: `TuiInteractionChannel.start()` → `transportRegistry.startAll(session)`
   (`agent-transport-tui/.../TuiInteractionChannel.ts:238-239`). So the GUI runs a headless-rendered terminal
   UI purely to get a transport started — the literal "GUI controls the CLI" smell.

2. **The session runtime is duplicated inside the presentation layers.** `InteractiveSession` is constructed
   **inside** `TuiInteractionChannel.createSession()` (`TuiInteractionChannel.ts:166`) and **again**, separately,
   inside `HeadlessInteractionChannel` for print mode (`agent-cli/src/modes/print-mode.ts:64`), with the
   option-mapping duplicated (`render.tsx:82-112` vs `print-mode.ts:64-94`). There is no single runtime both
   presentations sit over.

The TUI-free runtime assembly already exists as a contiguous block in `startCli()`
(`cli.ts:181-327`: preset → `buildCommandSetup` → transport registry + `WsTransport` → remote-control → provider
→ background/subagent runners → session store + resume), but it is inline in the CLI main and stops short of
building the session (that happens in the channel). The natural seam is right there.

## Architecture Review

### Placement Decision (the primary, owner-visible decision)

The decision is **where the shared headless runtime surface lives**, and it must satisfy the sibling principle:
both `agent-cli` (TUI) and `apps/agent-app` (GUI, via its spawned sidecar) drive the SAME runtime; neither
controls the other. Two viable placements:

|                 | **Design A (recommended) — headless runtime surface _within_ `agent-cli`**                                                                                                                                                                                                                                                                                           | **Design B — new `packages/agent-runtime` package**                                                                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shape           | Lift the runtime block (`cli.ts:181-327`) + `InteractiveSession` construction + the transport `startAll/stopAll` lifecycle out of the presentation channels into a **presentation-free `startRuntimeHost()` factory** in `agent-cli`; add a real headless entry (`robota --serve`, no ink) that runs it. The TUI channel and print channel consume the SAME factory. | Extract that factory into a standalone `packages/agent-runtime` package (session build + transport lifecycle + runtime assembly), consumed by `agent-cli` (TUI) and by a thin headless bin, with agent-app spawning that bin. |
| Sibling framing | agent-cli **exposes** a headless runtime surface (`--serve`); agent-app **consumes** it. Both the TUI and the headless entry sit over the one `startRuntimeHost` factory → siblings over a shared runtime.                                                                                                                                                           | Cleanest separation: the runtime is its own package; agent-cli and agent-app are both pure consumers.                                                                                                                         |
| Churn           | Medium. No package relocation; CLI-specific concerns (settings `~/.robota`, first-run, arg parsing) **stay in agent-cli** where they belong; only the session-build + lifecycle are lifted out of the channel.                                                                                                                                                       | High. Must relocate the runtime assembly across a package boundary and separate CLI-only concerns (settings/first-run) from runtime concerns; larger dependency re-wiring.                                                    |
| Risk            | Contained to agent-cli + the two channels; behavior-preserving for the TUI + print paths.                                                                                                                                                                                                                                                                            | Broad; touches package graph, publish surface, and every runtime import path.                                                                                                                                                 |

**Recommendation: Design A**, as the RUNTIME-001 deliverable. It fixes the concrete smell immediately (agent-app
spawns `robota --serve` → a real headless runtime, no ink-in-a-pipe), establishes the shared `startRuntimeHost`
factory that the TUI and print channels both consume (removing the duplicated session construction), and keeps
CLI-only concerns in the CLI. The standalone `packages/agent-runtime` (Design B) becomes warranted only if a
**non-CLI** runtime consumer emerges (e.g. a server host); recorded as a Phase-2 alternative, not now.

Mirror-analog (primary): **`apps/agent-web-monitor`** — `agent-cli` already **builds + serves a web GUI**
(`SessionMonitor`/`RemoteClient`) over the runtime as the composition-root/product-shell (project-structure.md).
Adding `robota --serve` for the desktop GUI mirrors that proven arrangement one-to-one: agent-cli is the
runtime-host product; `--serve` is its headless presentation; the ink TUI is its default presentation; the web
monitor is another. (Secondary analog: the `agent-transport` core/`TransportRegistry` split under multiple
presentations — the runtime host is its session-lifecycle counterpart.)

### Affected Scope

- `packages/agent-cli` — NEW `startRuntimeHost()` factory (assembles the runtime block + builds the
  `InteractiveSession` + **owns the transport `startAll/stopAll` lifecycle uniformly** + stays alive until
  signaled). NEW headless entry (`--serve`, no ink) that runs it and serves the WS. **Both `startRuntimeHost`
  and the `--serve` entry must live in ink-free modules NOT reached through `cli.ts`'s top-level
  `agent-transport-tui` static import** (`cli.ts:36`) — otherwise the serve process still loads ink, breaking
  TC-01/TC-02 and the #79(c) "headless entry, not the full product" intent GUI-003 bundles. `startCli()`
  refactored so the TUI path builds its session **from the shared factory** instead of re-constructing it.
  Update `packages/agent-cli/docs/SPEC.md` with the `startRuntimeHost` + `--serve` public surface (Live-Spec).
- `packages/agent-transport-tui` — `TuiInteractionChannel` no longer constructs its own `InteractiveSession`
  and **no longer drives `startAll/stopAll`** (the host owns the lifecycle uniformly); it receives an
  already-started session (or a session handle) and renders over it (touching it only via `interactiveSession`
  in `wireSessionEvents`/`abort`/`shutdown`/`getSession`). This is the highest-risk edit — verify TUI teardown
  (`shutdownSessionBounded`) still runs via the host's stop path.
- `apps/agent-app` — `electron/sidecar.ts` spawns the headless entry (`robota --serve` via `extraArgs`/command),
  NOT the default (ink) branch. No renderer change (still the shared GUI core over loopback-WS + nonce). Removes
  the ink-in-a-pipe.
- **Out of scope (stated):** the print/`--goal` path builds its OWN session in `HeadlessInteractionChannel`
  (`packages/agent-transport` core) with a **different** default (`permissionMode: 'bypassPermissions'`, an
  autonomous headless run) — a distinct surface, not the interactive runtime. RUNTIME-001 does NOT unify it;
  deduplicating print-mode (by injecting a session into `HeadlessInteractionChannel`, an `agent-transport` core
  - SPEC change) is a follow-up. TC-03 is therefore scoped to the TUI path.
- Docs/structure — `.agents/project-structure.md` (agent-cli gains a headless runtime surface; agent-app drives
  it as a sibling), arch-map (agent-system runtime/presentation split).

### Alternatives Considered

- **B — standalone `packages/agent-runtime`** (above): cleaner end-state, high churn; deferred to Phase-2 unless
  a non-CLI consumer appears.
- **C — status quo (spawn the default TUI in a pipe)**: REJECTED — it is the smell (GUI backend is a
  headless-rendered TUI; wasteful ink render; the exact "GUI controls CLI" framing the owner rejected).
- **D — an `isTTY` gate that silently switches to headless when stdout isn't a TTY**: REJECTED — implicit
  mode-switching is surprising and untestable; an explicit `--serve` runtime entry is the honest surface.

### Architecture Review Checklist

- [x] New-surface placement surfaced FIRST + independently validated — proposal-review 2026-07-12: **REVISE →
      placement ENDORSED** (Design A now, B Phase-2), 5 revisions applied (see Evidence Log).
- [x] Mirror-analog identified (primary: `apps/agent-web-monitor` — agent-cli already serves a GUI over the
      runtime; secondary: the transport-core/registry split under multiple presentations).
- [x] Reuse at shared-core level — the TUI path + the headless `--serve` entry consume ONE `startRuntimeHost`
      factory; the TUI channel no longer re-implements session construction. (Print-mode is a distinct
      autonomous surface, explicitly out of scope.)
- [x] No dependency cycle; the runtime surface (`startRuntimeHost` + `--serve` entry) is presentation-free —
      ink-free modules not reached through `cli.ts`'s `agent-transport-tui` import; agent-app consumes it by
      process-spawn, adding no import edge.
- [x] Transport lifecycle has a SINGLE owner — the host owns `startAll/stopAll` uniformly; the TUI channel stops
      driving them.
- [x] Sibling framing preserved in docs (GUI drives the shared runtime; does not control the CLI).
- [x] Behavior-preserving for the existing TUI path (print/`-p`/`--goal` unchanged, out of scope).

## Decision

Adopt **Design A**: a presentation-free, ink-free `startRuntimeHost()` factory (owning session construction +
the transport `startAll/stopAll` lifecycle) + a `robota --serve` headless entry in `agent-cli`; lift
`InteractiveSession` construction and the transport lifecycle out of `TuiInteractionChannel` so the TUI path and
the headless `--serve` path both sit over the one factory; point `apps/agent-app` at `--serve`. Print-mode
(`-p`/`--goal`) stays a distinct autonomous headless surface (out of scope). Standalone `packages/agent-runtime`
is the recorded Phase-2 if a non-CLI consumer emerges.

## Completion Criteria

- **TC-01** — `agent-cli` exposes `startRuntimeHost()` (presentation-free: no `agent-transport-tui`/ink import in
  its module graph) that assembles the runtime + builds the `InteractiveSession` + starts/stops the transport
  registry + stays alive until signaled. Unit-tested with a stub provider/registry.
- **TC-02** — a `robota --serve` (headless) entry runs `startRuntimeHost`, serves the WS (token/port from
  env/flags), renders NO ink, and shuts down cleanly on SIGTERM. Verified headlessly (no TTY).
- **TC-03** — the TUI path builds its session from the shared factory (no second `new InteractiveSession(` in
  `TuiInteractionChannel`; the channel renders over an already-started session and no longer calls
  `startAll/stopAll`); existing TUI behavior unchanged (regression tests + `tui-e2e` stay green). The print
  (`-p`/`--goal`) path is explicitly OUT of scope (distinct autonomous headless surface — see Affected Scope).
- **TC-04** — `apps/agent-app` spawns `robota --serve` (no ink rendered in the sidecar); the existing headless
  Electron e2e (5/5) stays green end-to-end over the real runtime host.
- **TC-05** — dependency-direction: the runtime surface (`startRuntimeHost` + `--serve` entry) imports no
  presentation package and is not reached through `cli.ts`'s ink import; no cycle; `pnpm harness:scan` green;
  `packages/agent-cli/docs/SPEC.md` updated with the new `startRuntimeHost` + `--serve` public surface
  (Live-Spec); `.agents/project-structure.md` + arch-map updated (agent-cli headless runtime surface; agent-app
  drives it as a sibling).

## Test Plan

- **TC-01** (command): unit test `startRuntimeHost` with a scripted provider + stub registry; assert session
  built + `startAll`/`stopAll` invoked; assert the module graph has no `agent-transport-tui` import.
- **TC-02** (command/e2e): spawn `robota --serve` with `ROBOTA_WS_TOKEN`/`PORT` under a non-TTY; assert a WS
  client connects (nonce) + a turn round-trips + SIGTERM exits 0; assert no ink output.
- **TC-03** (command): agent-cli + agent-transport-tui unit/regression tests + `tui-e2e` green; grep no second
  `new InteractiveSession(` in the presentation channels.
- **TC-04** (headless e2e, agent-owned): `apps/agent-app` Playwright `_electron` e2e 5/5 against the `--serve`
  sidecar (not the ink branch).
- **TC-05** (harness): affected typecheck + tests + `pnpm harness:scan` green; deps/conformance.

## Tasks

Deferred to GATE-IMPLEMENT (task file `.agents/tasks/RUNTIME-001.md` authored then). Preliminary shape: T1
extract `startRuntimeHost` factory (runtime block + session build + transport lifecycle); T2 add `--serve`
headless entry; T3 refactor TuiInteractionChannel + print-mode to consume the factory (no duplicated session);
T4 point apps/agent-app at `--serve`; T5 affected typecheck/tests/tui-e2e + agent-app e2e (agent-owned) +
harness + docs; T6 feature→develop→main via merge-verifier; T7 GATE-COMPLETE (+ note GUI-003 can now bundle the
headless entry).

## Evidence Log

### [proposal-review] — 🔧 REVISE (round 1) → revisions applied | 2026-07-12

Independent placement validation (proposal-reviewer), per the New-Surface Architecture Placement rule.
**Placement ENDORSED** — Design A now (a presentation-free `startRuntimeHost()` + `robota --serve` inside
`agent-cli`), Design B (`packages/agent-runtime`) correctly deferred to Phase-2. Reasoning: the owner already
ratified this shape (project-structure.md:58 + common-mistakes #79 b/c); zero dependency-graph risk (agent-app
consumes by process-spawn, no import edge); **B-now would violate Library Neutrality** (the runtime block
carries `~/.robota`/first-run/preset product concerns that may not live in a neutral package) — deferral is
principled, not diff-size-driven. All three problem premises verified TRUE against the code (ink-in-a-pipe;
duplicated `InteractiveSession`; TUI-free-but-CLI-flavored runtime block). `--serve` (not an isTTY gate) is the
correct seam (agreed).

Verdict **REVISE** on 5 corrections — all applied:

1. **Scope/TC-03 narrowed to the TUI path.** The print-path session is built in `HeadlessInteractionChannel`
   (`agent-transport` core) with a `bypassPermissions` autonomous default — a distinct surface. Unifying it
   would drag in an `agent-transport` core + SPEC change; RUNTIME-001 explicitly leaves it out of scope
   (recorded as a follow-up).
2. **Transport-lifecycle single-owner resolved** — the host owns `startAll/stopAll` uniformly; the TUI channel
   stops driving them (was the self-contradiction between TC-01 and Affected Scope).
3. **Ink-free-module constraint made explicit** — `startRuntimeHost` + the `--serve` entry must NOT be reached
   through `cli.ts`'s top-level `agent-transport-tui` static import (else the serve process loads ink),
   load-bearing for TC-01/TC-02 and for GUI-003's headless-entry bundling.
4. **Mirror-analog upgraded** to `apps/agent-web-monitor` (agent-cli already serves a web GUI over the runtime)
   as the primary analog.
5. **Live-Spec** — commit to updating `packages/agent-cli/docs/SPEC.md` with the `startRuntimeHost` + `--serve`
   public surface (added to TC-05 + Affected Scope).

### [GATE-WRITE] — ✅ PASS | 2026-07-12

**Status upgrade:** draft → review-ready

- Frontmatter: `---` YAML block present; `status: draft`; `type: INFRA` (valid single value from the 11-prefix list); `tags:` non-empty array `[runtime, architecture, cli, gui, headless, session, refactor]`. PASS.
- Problem: concrete symptoms with file:line evidence (`sidecar.ts:51-68`, `main.ts:67-73`, `cli.ts:367`, `TuiInteractionChannel.ts:238-239`/`:166`, `print-mode.ts:64`, `cli.ts:181-327`); reproduction condition stated ("no `--web`/headless-serve flag and no `isTTY` gate → falls through to the default interactive path"); no TBD/TODO/vague single-sentence. PASS.
- Architecture Review Checklist: all 7 items `[x]`; sibling/mirror-analog scan `[x]` with completion evidence (primary `apps/agent-web-monitor`, secondary transport-core/registry split); Alternatives Considered has ≥2 entries with pro/con (placement table Design A vs B, plus B/C/D with rejection rationale); Decision references the driving trade-off (fixes smell now, keeps CLI-only concerns in agent-cli, low churn/risk). PASS.
- New-Surface Placement (conditional, applies — introduces `startRuntimeHost` + `robota --serve` headless runtime surface): names the analogous existing layer it mirrors (`apps/agent-web-monitor` — agent-cli already builds+serves a web GUI over the runtime) + product-family classification (runtime-host product / headless presentation); reuse is at the shared-core/contract level (one `startRuntimeHost` factory consumed by TUI + `--serve`, not a skin on a sibling product); independent placement validation recorded in Evidence Log (proposal-review REVISE → placement ENDORSED, 5 revisions applied). PASS.
- Completion Criteria: every item TC-N prefixed (TC-01..TC-05); ≥1 criterion per distinct sub-item; Command/Observable-behavior form throughout; no banned vague phrases ("works correctly", "no errors", "implemented", "displays correctly"). PASS.
- Test Plan: `## Test Plan` present; 5 rows (TC-01..TC-05) — count matches Completion Criteria's 5 TCs exactly; each row has non-empty Test Type + Tool/Approach (command / command-e2e / command / headless-e2e / harness); no row uses "manual"; all rows well over ~50 chars. PASS.
- Structure: Tasks section present with placeholder (deferred to GATE-IMPLEMENT); Evidence Log section present (contains only the mandatory independent placement review required by the New-Surface rule — no prior gate record, compliant with the first-run intent); no `## Status` or `## Classification` sections in the body. PASS.
- TC-N count reconciliation: Completion Criteria = {TC-01, TC-02, TC-03, TC-04, TC-05}; Test Plan = {TC-01, TC-02, TC-03, TC-04, TC-05}. Match confirmed.

All GATE-WRITE criteria met. Status upgrade to `review-ready` authorized; file moved `draft/` → `backlog/`.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-12

**Status upgrade:** review-ready → approved

- Explicit owner approval directed at this spec, in the current conversation, via the GATE-APPROVAL question
  (asked in Korean at the owner's request) — owner answered verbatim: **"Design A (권장)"**. Unambiguous
  authorization of Design A (a presentation-free `startRuntimeHost()` factory + `robota --serve` headless entry
  inside `agent-cli`; lift session construction + transport lifecycle out of the TUI channel; point
  `apps/agent-app` at `--serve`; `packages/agent-runtime` deferred to Phase-2).
- Placement decision surfaced FIRST + independently validated (proposal-review round 1: REVISE → placement
  ENDORSED, 5 corrections applied) per the New-Surface Architecture Placement rule.
- No Architecture Review or frontmatter type/tags modified after approval.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-12

**Status upgrade:** approved → in-progress

- Prior-gate precondition: GATE-APPROVAL ✅ PASS (2026-07-12), owner verbatim "Design A (권장)"; frontmatter was
  `status: approved` in `todo/` — correct input stage.
- Tasks file exists + path recorded: `.agents/tasks/RUNTIME-001.md` (git-tracked); spec `## Tasks` references it.
- Tasks map to every Completion Criterion: T2→TC-01, T3→TC-02, T4→TC-03, T5→TC-04, T6→TC-05 (plus T1
  GATE-IMPLEMENT, T7 merge, T8 GATE-COMPLETE).
- Test Plan present in the task file (TC-01..TC-05 rows, ≥50 chars) satisfying the `test-plans` scan.
- Spec moved `todo/ → active/`; frontmatter `status: in-progress`.

### [decision-revision] — Design A → Design B (owner-directed) | 2026-07-12

During implementation of Design A, TC-03 (dedup the TUI's `InteractiveSession` construction) surfaced two
findings: (1) `TuiInteractionChannel` re-creates its session **per session-switch** (`render.tsx` `createChannel`
is re-invoked on resume/switch), so there is no single host-owned session for the TUI; (2) a shared
session-options builder cannot live anywhere both the ink `TuiInteractionChannel` (`agent-transport-tui`) and the
**ink-free** serve entry (`agent-cli`) can reach without violating dependency-direction or pulling ink into the
serve path — i.e. the shared builder needs a **neutral** home. That is exactly **Design B**.

The owner, shown this finding, chose **"지금 Design B 전체 (중립 agent-runtime 패키지)"** (do full Design B now).

**Revised decision (Design B):** extract a NEW neutral `packages/agent-runtime` package holding ONLY the
presentation-free runtime core — `buildRuntimeSession(TInteractiveSessionOptions)` + `startRuntimeHost(options +
transportRegistry)` (session build + transport `startAll/stopAll` lifecycle). It takes ALREADY-RESOLVED
`TInteractiveSessionOptions`; CLI-product concerns (`~/.robota` settings, first-run, preset resolution, arg
parsing) STAY in `agent-cli` and are passed in — so Library Neutrality is preserved (this resolves the
neutrality concern the round-1 review raised against B-now). Deps: `agent-framework` + `agent-interface-transport`
only. Consumers: `agent-cli` (serve-mode + startCli) and `agent-transport-tui` (`TuiInteractionChannel` builds
its per-switch session via the shared builder — the TC-03 dedup). The `startRuntimeHost` already implemented
(agent-cli/src/runtime/runtime-host.ts) is the neutral core and moves verbatim into `agent-runtime`.

Independent placement re-validation (proposal-review of the Design-B neutral-package boundary) requested before
GATE-re-APPROVAL; result recorded below.

### [decision-revision-2] — Design B → Design C (owner-approved) | 2026-07-12

Two independent reviews (proposal-review + architecture-auditor) REJECTED Design B (new `packages/agent-runtime`)
in favor of **Design C**: the neutral runtime host belongs in the existing assembly layer `agent-framework`, not a
new sibling package (single consumer; identical dep set; framework already owns `InteractiveSession` +
`TInteractiveSessionOptions`). Owner approved **"Design C 승인 · 진행"** and directed (common-mistakes #80): the
pre-existing duplication must be **reconciled, not preserved** — legacy is not the baseline, only correct
architecture is.

A runtime-construct map established the correct single seam + the real duplication:

- `startRuntimeHost` + `buildRuntimeSession` are ALREADY the right shape (full `TInteractiveSessionOptions`,
  presentation-free, own the transport start/stop + bounded-shutdown lifecycle). Their only flaw is **placement**.
- `createAgentRuntime` (`agent-framework/src/runtime/agent-runtime.ts`) speaks a LOSSY `IHeadlessSessionOptions`
  subset (missing persona/activePresetId/enableParallelSubagents/selfVerification/forkSession/language) and is
  consumed only by `apps/starter-nextjs` + stateless mode — leave it as the serverless factory; do NOT extend it.
- `createInteractiveRuntime` is a narrow programmatic channel-driver (only `createProgrammaticAgent`) — leave it.
- **Real duplication to reconcile:** (1) `TuiInteractionChannel` duplicates `startRuntimeHost`'s transport
  `startAll/stopAll` + bounded shutdown near-verbatim; (2) three sites (TUI, print, serve) each hand-roll a
  full-fidelity `TInteractiveSessionOptions` mapping and call `new InteractiveSession` independently.

**Design C plan:** move `buildRuntimeSession` + `startRuntimeHost` into `agent-framework/src/runtime/` (next to
`agent-runtime.ts`), export them; delete `packages/agent-runtime`; `agent-cli` serve-mode imports from
`agent-framework`. Reconcile the duplication: route the TUI + print session construction through
`buildRuntimeSession` (one construction seam), and collapse the TUI's duplicated transport lifecycle into
`startRuntimeHost` (add an `onSessionReady(session)` hook so the TUI can wire session events between build and
`startAll`). Unify all three on `TInteractiveSessionOptions`. Leave `createAgentRuntime`/`createInteractiveRuntime`
for their existing consumers. Independently validated (both reviews endorse C); owner-approved.
