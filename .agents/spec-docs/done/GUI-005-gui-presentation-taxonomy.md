---
status: done
type: INFRA
tags: [gui, architecture, presentation, electron, react, refactor]
---

# GUI-005: GUI presentation taxonomy — agent-transport-gui core + apps/agent-app

> Redesign directed + approved by the owner after GUI-002 shipped: agent-gui was built as a thin CONSUMER of
> `agent-web-ui` (the browser remote-monitor product), which diverged from the GUI-001 intent — "a GUI layer
> mirroring the TUI layer's role/architecture." The TUI (`agent-transport-tui`) is its OWN presentation layer;
> the GUI should be too. Owner taxonomy: **presentation = TUI | GUI**, and **GUI = app | web** over a shared
> GUI core. Owner also flagged that `agent-web-ui` should eventually be cleaned up (absorbed/deleted).

## Problem

`apps/agent-gui` (GUI-002) reuses `@robota-sdk/agent-web-ui`'s React components verbatim. That coupled the
desktop app's identity/UX to the **browser remote-monitor** product's design decisions, and classified the
desktop GUI under `agent-web-ui` — not an independent presentation layer. The proven pattern is the TUI:
`agent-transport-tui` (presentation package, its own components) hosted by `agent-cli` (app). The GUI has no
equivalent independent presentation layer; instead the desktop app is a skin on the browser library.

**Concrete symptom:** there is no `agent-transport-gui` presentation package; `apps/agent-gui` imports
`@robota-sdk/agent-web-ui/client` for its session UI, so the desktop app cannot evolve its own UX without
touching the browser product, and the two GUI surfaces (desktop app, browser web) share nothing structured —
their common session-rendering lives only inside the browser product.

## Architecture Review

### Affected Scope

Owner taxonomy → package/app structure (mirrors the TUI/CLI layering):

```
Presentation
├── TUI  → packages/agent-transport-tui         (hosted by apps/agent-cli)
└── GUI
    ├── (shared core) packages/agent-transport-gui   — React session rendering over the wire, product-neutral
    ├── app  → apps/agent-app     (Electron desktop; hosts agent-transport-gui)     [rename of apps/agent-gui]
    └── web  → apps/agent-web      (Next.js browser; via agent-web-ui → agent-transport-gui)
```

File classification of the current `agent-web-ui/src` (verified):

- **Generic GUI session (→ move to `agent-transport-gui`):** `components/ConversationView.tsx`,
  `components/PermissionPrompt.tsx`, `components/AgentActivityPanel.tsx`, `hooks/useWsSession.ts`
  (`useSessionClient` reducer + `useWsSession`), `hooks/prompt-state.ts`, `client/ws-session-client.ts`, the
  shared view-model types. Deps: `agent-interface-transport`, `agent-transport-protocol`, `react-markdown`,
  `remark-gfm`, `react` — **no `agent-remote-pairing`** (clean split).
- **Browser-remote-specific (→ stays in `agent-web-ui`):** `client/rtc-*`, `device-credential-store`,
  `parse-ice-servers`, `parse-remote-location`, `components/RemoteClient.tsx`, `components/SessionMonitor.tsx`,
  `useRtcSession`. These import the generics from `agent-transport-gui`.

### Alternatives Considered

- **Own presentation package + shared GUI core (chosen)** vs **each surface owns its own copy** (duplicates the
  reducer + 3 components across app/web — churn, drift) vs **keep reuse-agent-web-ui** (the rejected GUI-002
  status quo — desktop coupled to the browser product). The shared-core mirrors the taxonomy (GUI = app|web
  over one core) and dedups, while giving each surface its own shell/identity.
- **No re-export shim — `agent-web-ui` exports only its OWNED surface (chosen)** vs **a re-export shim**. A
  shim (`agent-web-ui` re-exporting the moved generics from `agent-transport-gui`) is **REJECTED**: it violates
  the repo's "no pass-through re-exports" rule (`common-mistakes.md` #4, `project-structure.md`) AND is
  unnecessary — after Phase 1 no consumer imports those generics from `agent-web-ui` (the only external consumer,
  `apps/agent-web/src/app/monitor/MonitorClient.tsx`, imports **only `SessionMonitor`**, which stays and is
  genuinely owned there; `agent-web-ui` is `private:true`, so there is no npm surface to preserve). Instead
  `SessionMonitor`/`RemoteClient` import the generics **internally** from `agent-transport-gui` (normal downward
  consumption, single owner), and `agent-web-ui/index.ts` exports only what it owns.
- **Status-type coupling (must split, not naively move).** `useSessionClient`/`useWsSession`/`useRtcSession`
  share `hooks/useWsSession.ts`, and the core reducer is typed against
  `TSessionStatus = TConnectionStatus | TRtcConnectionStatus` where `TRtcConnectionStatus` lives in the
  browser-remote `rtc-session-client.ts` (which STAYS). Moving the reducer as-is would force
  `agent-transport-gui → agent-web-ui` — a **cycle**. Chosen: make `useSessionClient` **generic over its status
  type** (core keyed on `TConnectionStatus`; the RTC surface widens it), so the core has **zero edge back** to
  `agent-web-ui`. Rejected: leaving the union in the core (cycle).
- **App folder rename is an ISOLATED, owner-confirmed step (not bundled).** The substantive change is rewiring
  the desktop app's renderer to `agent-transport-gui`; the `apps/agent-gui → apps/agent-app` rename (to parallel
  `apps/agent-web`) is pure mechanical churn (project-structure, capability-placement allowlist, GUI-002
  cross-refs) and rides in its OWN commit/task, owner-confirmed — it does not inflate the extraction's risk.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — NEW `packages/agent-transport-gui`; refactor `packages/agent-web-ui`
      (move-out, NO shim — export only owned surface); rewire the desktop app renderer (+ isolated
      `apps/agent-gui`→`apps/agent-app` rename); reuse
      `agent-transport-protocol`/`agent-interface-transport`/`agent-transport-ws`. `apps/agent-web` untouched.
- [x] Sibling scan 완료 — the direct sibling is `agent-transport-tui` (TUI presentation package hosted by
      `agent-cli`); this creates its GUI mirror (`agent-transport-gui` hosted by `apps/agent-app`). `agent-web-ui`
      is the existing browser surface whose generic parts are absorbed into the new core. N/A: no third
      presentation core is introduced — the taxonomy has exactly TUI + one GUI core.
- [x] 대안 최소 2개 검토 완료 — see Alternatives (shared-core vs per-surface-copy vs keep-reuse; re-export shim
      vs rewrite web; app naming).
- [x] 결정 근거 문서화 완료 — see Decision; mirrors the proven TUI/CLI layering, dedups via the shared core,
      and (per proposal-review) drops the shim + decouples the status type so the direction is cycle-free and
      rule-aligned.

**Design invariants:** dependency direction one-way + **acyclic** (`agent-transport-gui` → contract/protocol
packages only, never up; `apps/agent-app` → `agent-transport-gui`; `agent-web-ui` → `agent-transport-gui`) —
enforced by making the core status type generic (no `TRtcConnectionStatus` edge back); React-only frontend; **no
pass-through re-exports** (`agent-web-ui` exports only its owned browser-remote surface); no
session/command/permission logic in the presentation (it renders the wire `TServerMessage` stream — the sidecar
owns the runtime); the GUI-002 nonce loopback auth + the headless e2e carry over.

## Decision

**Phase 1 (this spec):**

1. **NEW `packages/agent-transport-gui`** — the shared GUI presentation core (mirror of `agent-transport-tui`):
   move the generic session components (ConversationView, PermissionPrompt, AgentActivityPanel) + `prompt-state`
   - `ws-session-client` out of `agent-web-ui`, and **SPLIT `hooks/useWsSession.ts`** — move `useSessionClient`
     (the reducer) + `useWsSession` + the view-model types here, **making `useSessionClient` generic over its
     status type** (core keyed on `TConnectionStatus`) so it has NO edge back to the browser-remote
     `TRtcConnectionStatus`; `useRtcSession` stays in `agent-web-ui` and widens the status there. Add the desktop
     shell (`SessionSurface`, `TitleBar`, `Composer`, empty/loading/fatal chrome) + the Tailwind v4 entry +
     terminal-noir theme (migrated from the GUI-004 WIP); package shape mirrors `agent-transport-tui` (tsdown,
     browser export, `react` peer).
2. **Refactor `agent-web-ui`** — depend on `agent-transport-gui`; its `index.ts` exports **only its owned
   browser-remote surface** (`SessionMonitor`, `RemoteClient`, `useRtcSession`, `createRtcSessionClient`,
   `createRtcSignalingClient`, `parseRemoteClientLocation`, RTC/connection status types). **NO re-export shim**
   of `agent-transport-gui` symbols (pass-through re-exports are banned). `SessionMonitor`/`RemoteClient` import
   the generics **internally** from `agent-transport-gui`. `apps/agent-web` (imports only `SessionMonitor`) is
   untouched.
3. **Rewire the desktop app renderer** to import `agent-transport-gui` (SessionSurface + a `useLoopbackSession`
   hook + theme) instead of `agent-web-ui` — the substantive change. The `apps/agent-gui → apps/agent-app`
   rename (parallel to `apps/agent-web`) is an **isolated, owner-confirmed mechanical step** in its own
   commit/task, not bundled with the extraction. Carry over the Electron shell/preload/sidecar/nonce/vite/e2e/docs.
4. Reuse `agent-transport-ws` (the GUI-002 nonce auth) unchanged; migrate the headless Playwright/xvfb e2e.

**Phase 2 (separate, later gate):** shrink/absorb `agent-web-ui` further (e.g. move `SessionMonitor` into
`apps/agent-web`, reduce `agent-web-ui` to the browser-remote client, or delete it) — the owner's "정리".

## Affected Files

- NEW `packages/agent-transport-gui/**` — `package.json`, `tsdown.config.ts`, `tsconfig`, `src/` (moved
  generics + new shell + theme), `docs/SPEC.md` + `docs/README.md`, tests.
- `packages/agent-web-ui/**` — `package.json` (+ `agent-transport-gui` dep), `src/index.ts` (exports only owned
  browser-remote surface — **no re-export shim**), browser-remote files import generics from
  `agent-transport-gui`; the moved generic files deleted. `hooks/useWsSession.ts` split (RTC part stays).
- **Desktop app** — renderer `src/` re-pointed to `agent-transport-gui`. The `apps/agent-gui` → `apps/agent-app`
  rename (own isolated commit, owner-confirmed): `package.json` name, `.agents/project-structure.md`,
  `scripts/harness/check-capability-placement.mjs` (line 104 `apps/agent-gui`→`apps/agent-app`),
  `.agents/spec-docs/done/GUI-002-*` cross-refs.
- `.agents/project-structure.md` — register the taxonomy (agent-transport-gui, the app surface).

## Completion Criteria

- [ ] **TC-01** — Command: `packages/agent-transport-gui` builds + typechecks; exports the session core
      (SessionSurface, useLoopbackSession, ConversationView, PermissionPrompt, AgentActivityPanel) and depends
      only on contract/protocol packages (no `agent-remote-pairing`, no `agent-web-ui`).
- [ ] **TC-02** — Command: `agent-web-ui` contains **NO re-export** of `agent-transport-gui` symbols (grep the
      `index.ts` — pass-through re-exports banned); it exports only its owned browser-remote surface; and
      `apps/agent-web` (imports only `SessionMonitor`) typechecks + builds **without modification**.
- [ ] **TC-03** — Observable: `apps/agent-app` (renamed) renders the session via `agent-transport-gui` (no
      `agent-web-ui` import); its headless e2e (Playwright `_electron` + xvfb) passes the full story
      (connect-with-nonce → reply → permission Allow → shutdown), captured for owner review.
- [ ] **TC-04** — Observable: dependency direction is one-way + **ACYCLIC** — `agent-transport-gui` →
      contract/protocol only (its core status type is generic, so **no `TRtcConnectionStatus` edge back to
      `agent-web-ui`**); the app + `agent-web-ui` → `agent-transport-gui`; the app has no
      `agent-framework`/`agent-core` dep (harness `deps` + capability-placement scans green; no cycle).
- [ ] **TC-05** — Command: `pnpm typecheck` (affected) + affected `pnpm test` (agent-transport-gui unit,
      app e2e, agent-web-ui) + `pnpm harness:scan` all green; changeset only if a published surface is affected
      (expected none — `agent-web-ui` is `private:true` and exports only its owned surface).

## Test Plan

| TC-N  | Test type                | Tool / approach                                                                                                                               |
| ----- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Command                  | `pnpm --filter @robota-sdk/agent-transport-gui build && typecheck`; assert exports + deps (package.json has no pairing/web-ui dep).           |
| TC-02 | Command                  | grep `agent-web-ui/src/index.ts` for NO `agent-transport-gui` re-export; `pnpm --filter robota-web typecheck && build` green, no source edit. |
| TC-03 | Headless e2e (agent-run) | migrated Playwright `_electron`+xvfb e2e on `apps/agent-app` → 5/5; screenshots captured + owner-reviewed.                                    |
| TC-04 | Static / harness         | dependency-direction assertion + `pnpm harness:scan` (`deps`, `capability-placement`) green; no cycle.                                        |
| TC-05 | Command (harness)        | affected typecheck + tests + `pnpm harness:scan` green; changeset check.                                                                      |

## Tasks

Task file: [`.agents/tasks/GUI-005.md`](../../tasks/GUI-005.md).

- [ ] T1: GATE-APPROVAL (proposal-review ENDORSE + owner sign-off).
- [ ] T2 (TC-01): Scaffold `packages/agent-transport-gui`; move the generic session components +
      `prompt-state` + `ws-session-client` + types; **SPLIT `hooks/useWsSession.ts`** — move `useSessionClient`
      (reducer) + `useWsSession`, making `useSessionClient` **generic over its status type** (keyed on
      `TConnectionStatus`, no `TRtcConnectionStatus` edge); add the shell (SessionSurface/TitleBar/Composer/chrome) + Tailwind entry + terminal-noir theme (from the GUI-004 WIP) + `useLoopbackSession`.
- [ ] T3 (TC-02): Refactor `agent-web-ui` — dep on `agent-transport-gui`; `index.ts` exports ONLY the owned
      browser-remote surface (**NO re-export shim**); `SessionMonitor`/`RemoteClient`/`useRtcSession` import
      generics internally from `agent-transport-gui`; delete the moved files; verify `apps/agent-web` untouched.
- [ ] T4 (TC-03): Rewire the desktop app renderer to consume `agent-transport-gui` (no `agent-web-ui` import);
      migrate electron shell + nonce + e2e; run the headless e2e + capture. Then, as an **isolated
      owner-confirmed commit**, rename `apps/agent-gui` → `apps/agent-app` (`@robota-sdk/agent-app`) + update the
      capability-placement allowlist + project-structure + GUI-002 cross-refs.
- [ ] T5 (TC-04): Dependency-direction + registration — `.agents/project-structure.md`, capability-placement
      allowlist; assert no cycle, no framework/core dep in the app.
- [ ] T6 (TC-05): affected typecheck + tests + `pnpm harness:scan` green; changeset if needed; SPEC/README for
      the new package + app.
- [ ] T7: feature→develop→main via merge-verifier at each hop; run the e2e myself (agent-owned).
- [ ] T8: GATE-COMPLETE — spec active→done; open Phase-2 backlog (agent-web-ui cleanup/absorption).

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-12

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: INFRA` (valid 11-prefix value); `tags:` present (non-empty array).
- Problem: concrete symptom (no `agent-transport-gui` package; `apps/agent-gui` imports `@robota-sdk/agent-web-ui/client`) + reproduction/where (desktop GUI coupled to browser product, two GUI surfaces share nothing structured); no TBD/TODO/vague single-sentence.
- Architecture Review Checklist: all 4 items `[x]`; Sibling scan `[x]` with evidence (`agent-transport-tui` mirror) + explicit `N/A: no third presentation core`; Alternatives ≥2 (shared-core vs per-surface-copy vs keep-reuse; re-export shim vs rewrite; app naming) each with pro/con; Decision cites driving trade-off (mirror proven TUI/CLI layering, dedup, byte-stable browser API via shim).
- Completion Criteria: TC-01..TC-05 all `TC-N` prefixed, each in Command or Observable form; no forbidden vague phrases ("works correctly"/"no errors"/"implemented"/"displays correctly").
- Test Plan: `## Test Plan` present; 5 rows (TC-01..TC-05) matching 5 Completion Criteria; each row has non-empty Test type + Tool/approach; no "manual"-only rows requiring Notes.
- Structure: `## Tasks` present with placeholder (T1–T8); `## Evidence Log` present and empty on first run; no `## Status`/`## Classification` in body.

### [proposal-review] — 🔧 REVISE (round 1) → revisions applied | 2026-07-12

Independent proposal-reviewer ENDORSED the DIRECTION (shared `agent-transport-gui` core mirroring
`agent-transport-tui`; both the desktop app and `agent-web-ui`'s `SessionMonitor`/`RemoteClient` consume it),
but returned REVISE on three concrete corrections — all applied:

1. **Cycle catch (critical).** `TSessionStatus = TConnectionStatus | TRtcConnectionStatus`; `TRtcConnectionStatus`
   lives in `client/rtc-session-client.ts` which STAYS in `agent-web-ui`. Moving the reducer as-is → a
   `agent-transport-gui → agent-web-ui` cycle. Spec now **splits** `useWsSession.ts` and makes `useSessionClient`
   **generic over its status type** (core keyed on `TConnectionStatus`; the RTC surface widens it) — zero edge
   back. TC-04 asserts acyclic.
2. **Drop the re-export shim (rule violation + unnecessary).** The shim violates "no pass-through re-exports"
   (`common-mistakes.md` #4) AND is needed by nobody: `apps/agent-web` imports only `SessionMonitor` (owned,
   stays); `apps/agent-app` imports the core directly; `agent-web-ui` is `private:true`. Spec now: `agent-web-ui`
   exports ONLY its owned browser-remote surface; `SessionMonitor`/`RemoteClient` import generics internally.
   TC-02 rewritten to assert no re-export.
3. **Isolate the app rename.** `apps/agent-gui → apps/agent-app` is pure churn bundled into a structural change.
   Spec now: the substantive change is rewiring the renderer to `agent-transport-gui`; the rename is an
   **isolated, owner-confirmed** commit (T4).

Rule-alignment in the review: one-way/acyclic deps ✓ (post-fix), no pass-through re-exports ✓ (shim dropped),
SSOT improved ✓, library-neutral core ✓. Re-review (round 2) requested.

### [proposal-review] — ✅ ENDORSE (round 2) | 2026-07-12

All three round-1 corrections verified in code + consistent across the spec: (1) the cycle fix — split
`useWsSession.ts`, `useSessionClient` generic on `TConnectionStatus` (no `TRtcConnectionStatus` edge back;
`useRtcSession` widens in agent-web-ui) — is stated in Decision §1 / Alternatives / invariants / TC-04;
(2) the re-export shim is dropped everywhere (agent-web-ui exports only its owned browser-remote surface;
`apps/agent-web` imports only `SessionMonitor`, unchanged; agent-web-ui is `private:true`) — no section
prescribes a shim; (3) the `apps/agent-gui→apps/agent-app` rename is isolated + owner-confirmed. No new
inconsistency. Direction aligned with the repo's acyclic-deps + no-pass-through-re-export rules. **Design gate
satisfied; GATE-APPROVAL pending (incl. the owner's rename decision).**

### [GATE-APPROVAL] — ✅ PASS | 2026-07-12

**Status upgrade:** review-ready → approved

- Explicit owner approval directed at this spec, in the current conversation, via the GATE-APPROVAL question —
  owner answered verbatim: **"승인 + apps/agent-app로 rename"**. Unambiguous confirmation of the ENDORSED
  redesign + authorization to implement, and a decision on the open item (do the `apps/agent-gui →
apps/agent-app` rename, as an isolated commit per T4).
- Placement decision surfaced first + independently validated (proposal-review 2 rounds → ENDORSE) per the
  new "New-Surface Architecture Placement" rule.
- No Architecture Review or frontmatter type/tags modified after approval.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-12

**Status upgrade:** approved → in-progress

- Prior-gate precondition: GATE-APPROVAL shows ✅ PASS (2026-07-12) with the owner's verbatim approval "승인 + apps/agent-app로 rename"; frontmatter was `status: approved` in `todo/` — correct input stage.
- Tasks file exists: `.agents/tasks/GUI-005.md` present on disk (git-tracked).
- Tasks file path recorded in `## Tasks`: spec opens the section with "Task file: [`.agents/tasks/GUI-005.md`](../../tasks/GUI-005.md)."
- Tasks map to every Completion Criterion: T2→TC-01, T3→TC-02, T4→TC-03, T5→TC-04, T6→TC-05 (plus T1 GATE-IMPLEMENT, T7 merge, T8 GATE-COMPLETE) — one task per TC-01..TC-05.
- Test Plan present: task file has a `## Test Plan` section (TC-01..TC-05 rows, ≥50 chars) satisfying the `test-plans` harness scan requirement. [AF-24]
- Note (non-blocking, not a gate criterion): the task file's TC-02 wording still references a "re-export shim", which the spec's post-proposal-review decision reversed (NO re-export shim). Content freshness of the task file is out of scope for this gate; flagged for the implementer to reconcile.
- Spec moved `todo/ → active/`; frontmatter set to `status: in-progress`. Task file stays in place.

### [GATE-VERIFY] — ✅ PASS | 2026-07-12

**Status upgrade:** in-progress → verify-passed

Every Completion Criterion verified (agent-owned; GUI verification not deferred to the owner):

- **TC-01** — `@robota-sdk/agent-transport-gui` builds (tsdown dual node/browser) + typechecks; exports the
  session core (`useSessionClient`/`useWsSession`/`createWsSessionClient`, prompt-state, `ConversationView`/
  `AgentActivityPanel`/`PermissionPrompt`/`SessionSurface`/`CenteredChrome`, `styles/theme.css`). Deps =
  `agent-interface-transport` + `agent-transport-protocol` + react-markdown/remark-gfm + react peer only — NO
  pairing, NO agent-web-ui. Unit tests 10/10.
- **TC-02** — `agent-web-ui` refactored to the browser-remote surface; imports the core directly and does NOT
  re-export it (proposal-review-corrected: exports only its owned RTC surface — no pass-through shim).
  `apps/agent-web` (robota-web) typecheck green with no source edit. web-ui unit tests 45/45.
- **TC-03** — `apps/agent-app` (renamed from `apps/agent-gui`) renders via `agent-transport-gui/client` (no
  agent-web-ui import); Vite+Tailwind renderer + Electron build clean; jsdom unit tests 12/12; headless
  Playwright `_electron`+xvfb e2e **5/5** over the real `WsTransport` sidecar; screenshots captured + shown to
  the owner (terminal-noir shell: title/status bar, user/agent blocks, composer + key hints, permission modal).
- **TC-04** — dependency-direction: `agent-transport-gui` → contract/protocol only; `agent-web-ui` +
  `apps/agent-app` → `agent-transport-gui`; no cycle (generic status param keeps RTC states out of the core);
  `apps/agent-app` has no agent-framework/agent-core dep. Registered in `.agents/project-structure.md` +
  capability-placement allowlist (`apps/agent-app`).
- **TC-05** — affected typecheck (agent-transport-gui, agent-web-ui, agent-app, robota-web) + tests (67 total) +
  `pnpm harness:scan` **49/49** green. All packages `private:true` → no changeset. SPEC + README authored for
  the new package + refactored for agent-web-ui + renamed app.

Independent architecture-conformance audit (architecture-conformance-auditor): **materially conformant** — deps
exact, no cycle, no pass-through re-export, correct peer-of-agent-transport-tui placement all HOLD. All five
findings (four doc-side + one unused-dep) applied before merge.

### [GATE-COMPLETE] — ✅ PASS | 2026-07-12

**Status upgrade:** verify-passed → done

- Shipped to `main`: implementation squash `55287530a` (#1137, feature→develop) promoted via #1138
  (develop→main merge `6dcff493e`). Both hops merge-verified (merge-verifier → LANDED: PASS): the new
  `packages/agent-transport-gui`, the renamed `apps/agent-app` (old `apps/agent-gui` gone), and `agent-web-ui`
  import-not-re-export are present on the remote target; CI green (build/quality/scans/security/compat-node18/
  release-grade verification); no unrelated drift.
- GUI verification agent-owned end-to-end (headless Electron test env built + run by the agent; not deferred).
- Follow-up filed: **GUI-006** backlog — unify the web GUI surface over `agent-transport-gui` and
  absorb/retire `agent-web-ui` (GUI Phase-2), per the owner's "agent-web-ui는 정리되어야겠다" directive.
- Parent GUI-001 backlog intent (a GUI layer mirroring the TUI) is now satisfied for the desktop surface; the
  web surface unification remains as GUI-006.

Spec moved `active/ → done/`; frontmatter `status: done`.
