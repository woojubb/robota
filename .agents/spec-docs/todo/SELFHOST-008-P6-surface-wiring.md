---
status: approved
type: DATA
tags: [memory, agent-cli, surface-wiring, agent-run-verification, selfhost-008]
---

# SELFHOST-008 P6: surface-wire the memory pipeline into agent-cli + agent-run e2e verification

## Problem

SELFHOST-008 shipped the neutral memory **library** end-to-end — P2 auto-capture, P3 per-turn recall, P4 semantic
decorator — each unit/functional-tested with fake providers and merged. **But no product surface enables any of it:** a
`grep` across `packages/agent-cli/src` + `apps/` finds ZERO references to `automaticMemory`, `recallMemory`,
`memoryStore`, or `createFileSystemMemoryStore`. All three are adapter-gated **OFF by default**, so when a user runs the
real `robota` agent, **nothing captures or recalls memory** — the pipeline is dark, and it was never verified by
actually running a real coding agent (only library unit tests). This violates the capability-reachability done-gate
([backlog-execution.md](../../rules/backlog-execution.md) → "Capability Reachability — no library-seam N/A dodge") and
the agent-owned-verification principle ([agent-run-capability-verification](../../memory/agent-run-capability-verification.md)).
Owner directive (2026-07-18): _selfhost features must include, in the plan, that the agent itself runs the real agent,
tests end-to-end, and completes verification._ P6 makes the merged P2/P3/P4 **reachable in `agent-cli` + verified by an
agent-run capture→recall end-to-end scenario the agent executes itself.**

## Prior Art Research

**Topic:** surface-level enablement UX for durable memory (per-turn recall + auto-capture) in a coding-agent CLI —
the enablement decision (default, mechanism, consent, scope, observability), not the internal mechanism.

### References consulted (product documentation)

- **Claude Code — memory** ([code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory)) — auto memory
  **ON by default**; toggle via interactive `/memory`, `autoMemoryEnabled` in settings.json, or
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`; **per-repository** store (a loaded `MEMORY.md` index + topic files); `/memory`
  browse/edit + live "Writing/Recalled memory" indicators + `/context`; plain-markdown, user-editable. No consent gate
  for local capture.
- **Anthropic Claude.ai — memory + incognito** ([support.claude.com](https://support.claude.com/en/articles/11817273),
  [claude.com/blog/memory](https://claude.com/blog/memory)) — **OFF by default (opt-in)** via Settings → Capabilities;
  **project-scoped**; incognito writes nothing. Privacy-first opt-in for content capture.
- **Cursor — Memories** ([cursor.com/changelog/1-0](https://cursor.com/changelog/1-0),
  [data-use](https://cursor.com/data-use)) — was **opt-in + approval-gated + project-scoped** (privacy-mode-off only),
  then **retreated in v2.1.x** (removed; export to static Rules). Aggressive auto-capture walked back.
- **Windsurf Cascade — Memories** ([docs.windsurf.com/windsurf/cascade/memories](https://docs.windsurf.com/windsurf/cascade/memories))
  — auto-generates (effectively on), **workspace-scoped**, local at `~/.codeium/windsurf/memories/`, Memories panel; no
  consent prompt; docs steer durable knowledge to Rules/AGENTS.md.
- **Mastra — semantic recall** ([mastra.ai/docs/memory/semantic-recall](https://mastra.ai/docs/memory/semantic-recall))
  — `semanticRecall` **disabled by default**; explicit opt-in config. Library posture = opt-in.
- **Cline / Aider / Continue** ([docs.cline.bot/features/memory-bank](https://docs.cline.bot/features/memory-bank),
  Aider `CONVENTIONS.md`, [docs.continue.dev/customize/rules](https://docs.continue.dev/customize/rules)) — no
  agent-written durable memory; **user-authored static files**; enablement = create/point at a file.

### Observed common shape

- **Default splits by product class:** local, transparent on-disk stores ship ON (Claude Code) or effectively on
  (Windsurf); cloud/consumer surfaces and neutral libraries ship OFF/opt-in (Claude.ai, Mastra, pre-retreat Cursor).
  The most aggressive auto-capturer (Cursor) **retreated** to static rules.
- **Mechanism = a persisted settings toggle, not a per-invocation flag** (Claude Code `autoMemoryEnabled`; settings
  panels elsewhere); a `--flag`/env is at most an override/CI escape hatch.
- **Granularity = one user-facing switch** (no consumer peer separates capture vs recall).
- **Consent tracks store location:** local editable stores need no blocking consent (the file is the privacy story);
  content-leaves-machine paths are opt-in/approval-gated.
- **Scope default = project/workspace/repo**, global is the deliberate broadening.
- **Observability = a list/inspect command + a labeled recall indicator + plain-text store** (universal; the
  precondition that makes ON-by-default safe later).

### Recommendation for Robota P6 (adopted below)

1. **Default OFF (opt-in) for v1** — despite a local store: the library is adapter-gated OFF, Cursor retreated, Mastra
   is default-off, and Claude.ai (the Anthropic surface that captures user _content_, like Robota's auto-capture) is
   opt-in. Claude Code's ON-by-default is the outlier and earns it with a mature `/memory` surface. Ship OFF; revisit
   ON-by-default after observability matures. Matches Robota's "no silent behavior change" posture.
2. **Mechanism = persisted `settings.json` `memory` entry (SSOT) + `--memory`/`--no-memory` run override + a
   `ROBOTA_MEMORY` env escape hatch** (mirrors Claude Code's `autoMemoryEnabled` + env). **One user-facing switch**
   (capture+recall together); the library's separate P2/P3 gates stay internal.
3. **Consent = no blocking prompt for the local store; a one-time notice on first enable** (what/where/how-to-disable).
4. **Scope = repo/project-scoped** (`<cwd>/.robota/memory/`, already the fs store default); global is a later opt-in.
5. **Observability = the existing `/memory` command (list/inspect) + the P3 `<recalled-memory>` block + plain-markdown
   store** — a P6 requirement (and exactly what lets the agent self-verify enablement).

## Architecture Review

### Affected Scope

- **The wiring point (verified against code).** `buildRuntimeSession(options)` (`agent-framework/runtime/runtime-host.ts`)
  is the single session-construction seam; it passes fully-resolved `TInteractiveSessionOptions` straight to
  `new InteractiveSession(options)` and needs NO change. The **consumer (`agent-cli`) resolves the options** at each
  presentation: the print channel (`agent-transport/headless/HeadlessInteractionChannel.ts:93` → `buildRuntimeSession`),
  `serve-mode.ts:60` (`sessionOptions`), and the TUI channel. P6 adds a **memory-config resolver in `agent-cli`** that,
  from the resolved settings/flags, produces `{ memoryStore, automaticMemory?, recallMemory? }` and merges it into the
  `TInteractiveSessionOptions` at those sites (a shared helper so all three surfaces enable memory identically).
- **Enablement resolution (new, agent-cli).** Resolve a single `memory` switch from: `settings.json` `memory.enabled`
  (SSOT) ← overridden by `--memory`/`--no-memory` ← overridden by `ROBOTA_MEMORY=1|0` (CI/scripting). Default OFF. When
  ON: `memoryStore = createFileSystemMemoryStore(cwd)`; `recallMemory = { budget: <default> }`; `automaticMemory =
{ policy: <default>, retrieval: <budget> }`. **Policy default = `approval_required`** (queue) per the P2 safe default;
  a `memory.autoSave: true` setting flips to `auto_save`. One user-facing switch; policy is a sub-setting.
- **Observability (mostly present).** The `/memory` command (P1R, wired through `getMemoryStore()`) already lists/inspects
  the store; P3 renders a distinct `<recalled-memory>` block into the turn's model input. P6 adds a concise **enable-time
  one-time notice** (what's captured / where / how to disable) and confirms `/memory` surfaces captured + pending entries.
- **NOT changed:** the neutral library (`packages/agent-framework` memory) — P6 is surface wiring only; no memory
  content/prompt/SDK added to `packages/` (HARNESS-029 stays green). Enablement/policy/budget are surface-owned.
- **Agent-run verification (the core deliverable).** Using `-p` print mode (agent-executable) with a real provider:
  **run A** — `robota -p --memory "remember that this project is released with 'pnpm ship'"` → capture (queued or saved);
  if queued, approve via `robota -p "/memory approve <id>"` (or default `auto_save` for the demo); **run B (fresh
  session, same cwd)** — `robota -p --memory "how do I release this project?"` → the captured fact is recalled into the
  turn (the `<recalled-memory>` block is present / the answer reflects `pnpm ship`). Evidence: transcripts +
  `<cwd>/.robota/memory/` artifacts, saved under `.agents/evals/scenarios/`.

### Alternatives Considered

1. **Default OFF, settings.json SSOT + `--memory`/env override, one switch, repo-scoped, existing `/memory` observability,
   wired at the agent-cli option-resolution layer (CHOSEN).**
   - ✅ Matches the prior-art enablement consensus (opt-in for content capture; persisted toggle + override; one switch;
     repo scope; list/inspect + recall indicator). Wires at the correct layer (agent-cli resolves options;
     `buildRuntimeSession` unchanged). Neutral (library untouched). Agent-executable via `--memory`/env for verification.
   - ❌ Slightly more than a flag-only design (settings + flag + env) — but that IS the peer pattern and is what enables
     programmatic/CI enablement.
2. **Default ON (Claude Code style).**
   - ✅ Zero-config; memory "just works."
   - ❌ Robota lacks Claude Code's mature inspection UX; auto-capturing user content silently is the Cursor failure mode;
     violates "no silent behavior change." REJECTED for v1 (revisit after observability matures).
3. **Flag-only (`--memory` every run, no persisted setting).**
   - ✅ Simplest.
   - ❌ No peer requires a per-invocation flag; a user would re-pass it every run. The persisted setting is the SSOT with
     the flag as override. REJECTED.
4. **Wire memory inside `buildRuntimeSession` / the framework runtime (not agent-cli).**
   - ✅ One wiring site.
   - ❌ Puts the enablement POLICY (a product/UX decision) into the neutral framework layer; `buildRuntimeSession` is
     deliberately presentation-neutral (takes resolved options). Enablement belongs in the consumer. REJECTED (layering).

### Decision

Adopt (1): a **default-OFF, opt-in** memory switch resolved in `agent-cli` from `settings.json` `memory` (SSOT) with
`--memory`/`--no-memory` + `ROBOTA_MEMORY` overrides; when ON, a shared resolver injects `memoryStore` (fs default) +
`recallMemory` + `automaticMemory` (policy default `approval_required`, `memory.autoSave` flips to `auto_save`) into the
resolved `TInteractiveSessionOptions` at every agent-cli construction site (print/serve/TUI); `buildRuntimeSession`
unchanged. One user-facing switch; repo-scoped store; a one-time enable notice; observability via the existing `/memory`
command + the P3 recall block. The neutral library is untouched (HARNESS-029 green). Verified by an **agent-run
capture→recall e2e** the agent executes via `-p` print mode with a real provider.

### Validated Recommendation

- **Reachability (verified):** the three agent-cli construction sites (print/serve/TUI) all resolve
  `TInteractiveSessionOptions` before `buildRuntimeSession`/`InteractiveSession`; injecting the memory fields there makes
  the merged P2/P3/P4 live. The fs store persists to `<cwd>/.robota/memory/`, so a fact captured+saved in run A is
  present for run B's per-turn recall (cross-session), independent of session-transcript persistence.
- **Capability preservation:** default OFF ⇒ zero behavior change for users who don't opt in; existing `/memory` manual
  command unchanged.
- **Adversarial:** (a) silent content capture → default OFF + one-time notice + `approval_required` default (queue, not
  auto-save); (b) low-precision auto-save → the keyword extractor only fires on explicit "remember …" cues + queue
  default; (c) policy/content creeping into `packages/` → only agent-cli resolves enablement; library untouched;
  HARNESS-029 green; (d) verification not actually agent-run → the scenario is `-p`-scriptable and I run it (evidence
  captured), per the capability-reachability gate.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: `agent-cli` (memory-config resolver + inject at the print/serve/TUI construction sites) +
      **`agent-transport`** (`IHeadlessInteractionChannelOptions` forwards the memory fields) + **`agent-transport-tui`**
      (`renderApp`/`TuiInteractionChannel` option surface forwards them) — honest scope: two transport option interfaces
      are extended (the established option-forwarding idiom, not a re-export). The neutral `agent-framework` memory
      library + `buildRuntimeSession` are UNCHANGED. No memory content/prompt/SDK in `packages/`.
- [x] Sibling scan 완료 — mirrors how agent-cli already resolves other `TInteractiveSessionOptions` (permissionMode,
      allowedTools, model) from settings/flags; reuses `createFileSystemMemoryStore` + the P2 `automaticMemory` / P3
      `recallMemory` seams + the existing `/memory` command; no new escape hatch beyond the declared P2/P3 degradations.
- [x] 대안 최소 2개 — 4 considered (opt-in settings+flag CHOSEN; default-ON REJECTED silent-capture; flag-only REJECTED
      no-SSOT; wire-in-framework REJECTED layering), each Pro+Con.
- [x] 결정 근거 — default-off opt-in (Cursor retreat / Mastra / Claude.ai content-capture evidence) + persisted-setting
      mechanism (Claude Code) + repo scope + existing-observability + correct wiring layer (agent-cli resolves,
      buildRuntimeSession neutral) + the owner agent-run-verification directive. New-surface placement N/A (wiring within
      existing agent-cli; no new package/app).

## Fallback & Degradation Declaration

No NEW fallback. The runtime degradations were already declared by P2 (post-turn capture error → skip, never breaks the
turn) and P3 (recall error → skip injection). P6 only turns those declared, `allow-fallback:`-annotated paths ON at the
surface; it introduces no new swallow. Default OFF means absence of the setting = today's behavior exactly.

## Solution

Add a `agent-cli` memory-enablement resolver: read `settings.json` `memory` (SSOT) with `--memory`/`--no-memory` + a
`ROBOTA_MEMORY` env override (default OFF, one switch). When enabled, a shared helper produces
`{ memoryStore: createFileSystemMemoryStore(cwd), recallMemory: { budget }, automaticMemory: { policy, retrieval } }`
(policy default `approval_required`; `memory.autoSave` → `auto_save`) and merges it into the resolved
`TInteractiveSessionOptions` at the print, serve, and TUI construction sites (a one-time enable notice on first use).
`buildRuntimeSession` and the neutral memory library are unchanged. Observability via the existing `/memory` command +
the P3 `<recalled-memory>` block. Verify by an agent-run `-p` capture→recall e2e with a real provider; save the scenario.

## Affected Files

| File                                                                                                                           | Change                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-cli/src/…/memory-enablement.ts` (new)                                                                          | resolve the `memory` switch (settings.json ← `--memory`/`--no-memory` ← `ROBOTA_MEMORY` env; default OFF) → `{ memoryStore, automaticMemory?, recallMemory? }`                                                            |
| `agent-transport` `IHeadlessInteractionChannelOptions` (`HeadlessInteractionChannel.ts`) + `agent-cli/src/modes/print-mode.ts` | extend the channel option interface to forward the memory fields (established option-forwarding idiom, NOT a pass-through re-export); merge into the print-path `TInteractiveSessionOptions` before `buildRuntimeSession` |
| `packages/agent-cli/src/modes/serve-mode.ts`                                                                                   | merge the resolved memory options directly into `sessionOptions` (already a `TInteractiveSessionOptions`)                                                                                                                 |
| agent-transport-tui `renderApp` / `TuiInteractionChannel` option surface + agent-cli TUI construction (`cli.ts` `renderApp`)   | extend the TUI channel option surface to forward the memory fields; merge at the TUI construction site (parity across surfaces)                                                                                           |
| agent-cli settings schema + `--memory`/`--no-memory` arg parsing                                                               | add the `memory` settings entry + flag + the one-time enable notice                                                                                                                                                       |
| `packages/agent-cli/src/__tests__/…` (new)                                                                                     | unit: resolver precedence (settings/flag/env, default off) + options-injection on/off                                                                                                                                     |
| `.agents/evals/scenarios/selfhost-008-memory-agent-run.md` (new)                                                               | the AGENT-RUN capture→recall e2e scenario (`-p`, real provider) + captured evidence                                                                                                                                       |
| `packages/agent-cli/docs/SPEC.md`                                                                                              | document the `memory` setting/flag/env, default-off, scope, observability                                                                                                                                                 |

## Completion Criteria

- [ ] TC-01: **default OFF** — with no `memory` setting/flag/env, no memory options are injected (no capture, no recall);
      behavior is exactly today's (unit test on the resolver + a `-p` run showing no `.robota/memory/` write).
- [ ] TC-02: **enablement precedence** — `settings.json memory.enabled` is the SSOT; `--memory`/`--no-memory` overrides
      it; `ROBOTA_MEMORY=1|0` overrides both (unit test on the resolver).
- [ ] TC-03: **injection** — when enabled, the resolved `TInteractiveSessionOptions` carry `memoryStore` +
      `recallMemory` + `automaticMemory` (unit test on the shared merge helper for the print/serve/TUI paths).
- [ ] TC-04 (**AGENT-RUN capture**): a real `robota -p --memory` run with an explicit "remember that …" cue captures the
      fact to `<cwd>/.robota/memory/` (saved, or queued-then-approved) — the AGENT executes this and captures evidence.
- [ ] TC-05 (**AGENT-RUN recall, the headline**): a fresh `robota -p --memory` run in the same cwd, asked a paraphrased
      question, RECALLS the captured fact into the turn (the `<recalled-memory>` block is present / the answer reflects
      it) — the AGENT executes this end-to-end with a real provider and captures evidence. **Precondition (explicit):**
      the fact must be in a SAVED state before run B — under the default `approval_required` policy a queued candidate is
      NOT recallable (recall reads saved topics, not `pending.json`), so the demo uses EITHER `memory.autoSave: true`
      (an explicit "remember …" cue is high-confidence → auto-saved) OR an intermediate `robota -p "/memory approve <id>"`
      (id from `robota -p "/memory pending"`) between run A and run B.
- [ ] TC-06: **neutrality** — no memory content/prompt/SDK added to `packages/`; `pnpm harness:scan` (memory-neutrality + deps) green; the neutral library + `buildRuntimeSession` unchanged.
- [ ] TC-07: **observability** — `/memory` lists the captured/pending entry after TC-04, and the enable path prints the
      one-time notice (unit/functional + shown in the agent-run evidence).

## Test Plan

| TC    | Verification                                                     | Type/Tool                       | Test reference                                                   |
| ----- | ---------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------- |
| TC-01 | default off ⇒ no memory options / no store write                 | vitest unit + `-p` run          | `memory-enablement.test.ts` › "default off" + agent-run evidence |
| TC-02 | settings ← flag ← env precedence                                 | vitest unit                     | same file › "precedence"                                         |
| TC-03 | enabled ⇒ options carry memoryStore/recallMemory/automaticMemory | vitest unit                     | same file › "injection"                                          |
| TC-04 | AGENT-RUN: `-p --memory` captures the fact to `.robota/memory/`  | agent-run (`-p`, real provider) | `.agents/evals/scenarios/selfhost-008-memory-agent-run.md`       |
| TC-05 | AGENT-RUN: fresh `-p --memory` recalls the fact (paraphrased)    | agent-run (`-p`, real provider) | same scenario (the headline capture→recall proof)                |
| TC-06 | no memory content/prompt/SDK in `packages/`                      | `pnpm harness:scan` + review    | memory-neutrality + dependency-direction green                   |
| TC-07 | `/memory` lists the entry + one-time enable notice printed       | vitest/functional + agent-run   | same scenario + a `/memory` list assertion                       |

## Tasks

[`.agents/tasks/SELFHOST-008-P6.md`](../../tasks/SELFHOST-008-P6.md) — created at GATE-IMPLEMENT; slices S1–S5 (resolver → print/serve/TUI injection → observability notice → unit tests → agent-run e2e verification) mapped to TC-01..07.

## Evidence Log

_GATE entries appended by the pipeline._

### [GATE-WRITE] — ✅ PASS | 2026-07-18

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: DATA` (valid 11-prefix value); `tags:` present (`[memory, agent-cli, surface-wiring, agent-run-verification, selfhost-008]`).
- Problem: concrete symptom (grep across `packages/agent-cli/src` + `apps/` finds ZERO references to `automaticMemory`/`recallMemory`/`memoryStore`/`createFileSystemMemoryStore`; pipeline dark, OFF by default) + reproduction (when a user runs the real `robota` agent nothing captures/recalls); no TBD/TODO.
- Prior Art Research: `## Prior Art Research` present; cites six product-documentation sources (Claude Code, Claude.ai, Cursor, Windsurf, Mastra, Cline/Aider/Continue); findings feed the Recommendation → Alternatives Considered → Decision (evidence-based, not asserted).
- Architecture Review Checklist: all 4 items `[x]`; Sibling scan `[x]` with completion evidence; Alternatives Considered has 4 entries each with Pro+Con; Decision references the driving trade-offs; new-surface placement explicitly N/A (wiring within existing agent-cli, no new package/app).
- Completion Criteria: 7 items, all TC-prefixed (TC-01…TC-07); each in command/observable form (TC-04/TC-05 are AGENT-RUN e2e capture→recall criteria); no banned vague language.
- Test Plan: `## Test Plan` present; 7 rows matching 7 TC-N (count matches); each row has non-empty Type/Tool + reference; no "TBD"; no bare "manual" rows.
- Structure: Tasks section present with placeholder; Evidence Log present (empty before this run); no `## Status`/`## Classification` body sections.
- Mechanical scans confirmed passing: `scan-spec-research.mjs` (exit 0), `check-spec-doc-frontmatter.mjs` (exit 0, only expected non-blocking SELFHOST-008 duplicate-ID warn). Completion Criteria = 7, Test Plan = 7.

### [GATE-APPROVAL] — ENDORSE (proposal-reviewer) | 2026-07-18

Independent `proposal-reviewer` verified every load-bearing premise against code and returned **ENDORSE**: (1)
`buildRuntimeSession` passes resolved options through unchanged; (2) `TInteractiveSessionOptions` accepts
`memoryStore`/`automaticMemory`/`recallMemory` (default-off = omit = today's behavior); (3) **the capture→recall policy
flow is correct** — `approval_required` QUEUEs (pending.json, not saved), `auto_save` SAVEs, and `recall()` reads only
SAVED topics, so the e2e demo must use `auto_save` OR capture→`/memory approve`→recall (the spec routes through both;
verified the explicit "remember …" cue is HIGH_CONFIDENCE 0.9 ≥ 0.85 auto-save threshold + the paraphrased query
topic-name-matches); (4) `/memory` list/show/pending/approve resolve the SAME injected store (no split-brain); (5)
print mode is `-p`-scriptable incl. slash commands, fs store persists cross-invocation under `<cwd>/.robota/memory/`.
All three live construction sites (print/serve/TUI) confirmed, none missed. Rule-alignment: layering, no-pass-through,
no-fallback, capability-reachability, architecture-placement (N/A) — all aligned. Two non-blocking tightenings folded
in: TC-05 SAVED-state precondition made explicit; the two transport option interfaces (`IHeadlessInteractionChannelOptions`

- `renderApp`/`TuiInteractionChannel`) named in Affected Files + the checklist (honest 3-package scope). Awaiting owner
  sign-off to complete GATE-APPROVAL.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-18

**Status upgrade:** review-ready → approved

- Prior-gate precondition: `[GATE-WRITE] — ✅ PASS | 2026-07-18` present; frontmatter `status: review-ready`; file in `spec-docs/backlog/` — expected input stage matches.
- Owner explicit approval (verbatim): the owner answered the GATE-APPROVAL question with **"승인 (추천)"** — a direct, unambiguous statement authorizing implementation of this spec.
- Direct + directed: the approval confirms this spec document's design (not a clarifying-question answer, not approval of a different item).
- No post-approval edits to Architecture Review or frontmatter `type`/`tags`.
- Independent design review: `[GATE-APPROVAL] — ENDORSE (proposal-reviewer)` entry present — every load-bearing premise verified against code (buildRuntimeSession neutral pass-through; `TInteractiveSessionOptions` accepts `memoryStore`/`automaticMemory`/`recallMemory`; capture→recall policy flow correct — `approval_required` queues / `auto_save` saves / recall reads only saved topics; `/memory` resolves the same injected store; `-p` print mode agent-runnable + fs store persists cross-invocation); two non-blocking tightenings folded in (TC-05 SAVED-state precondition explicit; two transport option interfaces named for honest 3-package scope).
- Independent architecture validation (conditional): N/A — no new package/app/surface; wiring is within existing `agent-cli` plus extending two existing transport option interfaces (the established option-forwarding idiom, not a new surface or product-family boundary). New-surface placement review not required.
