---
status: in-progress
type: INFRA
tags: [memory, neutrality, scan, harness, selfhost-008]
---

# HARNESS-029: mechanical memory-neutrality floor over `packages/*/src`

## Problem

SELFHOST-008's library-neutrality invariant — **no memory CONTENT and no app-voice curation PROMPT/policy in
`packages/`** (content lives in the consumer workspace `<cwd>/.robota/memory/`; the capture prompt/policy is
surface-supplied) — is enforced today **only by manual grep/review** (P1 TC-06, P2 TC-06). No `pnpm harness:scan`
rule fences it: `scan-memory-mirror.mjs` governs the DIFFERENT `.agents/memory` harness mirror, and
`deps`/`interface-imports`/`interface-runtime` do not check content. That is the exact gap enforcement-architecture
warns against (every guardian needs a mechanical floor) — and it becomes load-bearing at **SELFHOST-008 P3/P4**, the
slice that first injects a semantic backend + could smuggle a model-facing capture prompt or seeded corpus into the
library. Concrete symptom: a future P3/P4 commit could add a `const CAPTURE_PROMPT = "You are …"` to
`packages/agent-framework/src/memory/` or seed a `MEMORY.md`/`topics/*.md` corpus under `src/`, and nothing mechanical
would catch it — neutrality would silently rest on a reviewer noticing. (Filed by SELFHOST-008 P1 TC-06; owner chose to
implement it before P3/P4.)

## Prior Art Research

Waived: internal-consistency mechanical floor aligning to the repo's OWN established neutrality/marker scan precedents
(identified during SELFHOST-008) — not a new external capability, so an external product sweep is not load-bearing. The
authoritative prior art is in-repo:

- **`scan-orchestration-neutrality.mjs`** (SELFHOST-001 TC-05): a standing floor over `packages/*/src/**/orchestration`
  flagging app-domain identity (`room`/`persona`/`topic`) in the neutral contracts, with an identifier-CONTAINING match
  so camelCase smuggling is caught. The direct template for a neutrality floor.
- **`scan-no-fallback.mjs`** (HARNESS-028): a `packages/<pkg>/src` scan joining `run-all-scans.mjs`, with a
  high-confidence pattern set, an `allow-fallback: <reason>` escape hatch, and a reason-less anti-rot. The template for
  a `packages/`-source scan with a suppression convention.
- **`scan-conflict-markers.mjs`**: a prose scan with a documented allowlist. Confirms the pattern of a scanner +
  small, reasoned allowlist.

**Recommendation (adopted below):** a `scan-memory-neutrality.mjs` over `packages/*/src`, mirroring
`orchestration-neutrality` (its closest analog), flagging TWO high-confidence classes: (1) **seeded memory CONTENT** —
a `MEMORY.md` or `memory/topics/**` file under `packages/*/src` (unambiguous; zero today); (2) **app-voice curation
PROMPT in the library** — a memory-subsystem source declaring a prompt/persona/instruction identifier assigned a
non-trivial string literal (≥40 chars) (zero today: the memory subsystem has no prompt-identifier constants and no
≥60-char string literals — verified). Scope is `packages/` ONLY (the surface `agent-cli`/`apps` is where prompts +
content belong). A sanctioned exception carries `// allow-memory-content: <reason>`; a reason-less one fails (mypy
`ignore-without-code` analogue, mirroring HARNESS-028's anti-rot). Registered in `run-all-scans.mjs` (→ CI `scans`) and
runs at GATE-VERIFY.

## Architecture Review

### Affected Scope

- **`scripts/harness/scan-memory-neutrality.mjs` (new) + `run-all-scans.mjs`**: the mechanical floor over
  `packages/*/src`, joining `pnpm harness:scan` (→ CI `scans` job) and re-run at GATE-VERIFY. Mirrors the STRUCTURE of
  `scan-orchestration-neutrality.mjs` (exported pure `findMemoryNeutralityFindingsInSource(src, file)` for unit tests +
  a `findMemoryNeutralityFindings()` live-tree scan) and the `scan-no-fallback.mjs` suppression/anti-rot convention.
- **v1 flags TWO classes (high-confidence, near-zero false positive):**
  1. `seeded-memory-content`: a file under `packages/*/src` named `MEMORY.md`, or under a `.../memory/topics/` path
     (the durable corpus belongs in `<cwd>/.robota/memory/`, never the library). File-path check.
  2. `library-capture-prompt`: within the memory subsystem (`packages/*/src` files whose path contains a `memory`
     segment, excluding `__tests__`), a declaration whose identifier matches `/(prompt|persona|instruction)/i` assigned
     a **string literal of ≥40 chars** (a model-facing capture prompt is a sentence, not a short token). Suppressible by
     an adjacent `// allow-memory-content: <reason>`.
- **anti-rot (v1 = reason-less-only, mirrors HARNESS-028):** a reason-less `allow-memory-content` (comment, no
  `: <reason>`) fails. Stale-detection deferred (same rationale as HARNESS-028: a narrow flagged set).
- **NOT covered (documented deferrals):** `apps/**/src` + `agent-cli` (the SURFACE — prompts + content legitimately
  live there; scanning them would be wrong); the existing regex extractor / policy-evaluator constants (they are the
  library's neutral REFERENCE policy the spec permits, and are not prompt-identifier string literals ≥40 chars, so v1
  does not flag them); semantic/embedding prompt templates once a concrete backend lands in a surface (out of library
  scope by construction).

### Alternatives Considered

1. **Dedicated `scan-memory-neutrality.mjs` over `packages/*/src` (mirror orchestration-neutrality) — 2 high-confidence
   classes + reason-less anti-rot (CHOSEN).**
   - ✅ Mirrors the proven neutrality-scan precedent; high-confidence classes keep false positives ~zero (green on
     introduction — verified no seeded corpus + no prompt constants today); joins the existing `scans` gate; a reasoned
     escape hatch matches HARNESS-028.
   - ❌ Identifier+length heuristic for the prompt class is narrower than a semantic "is this app-voice" check (a
     determined author could evade with an odd identifier) — acceptable for v1; the seeded-content class is exact.
2. **Extend `scan-no-fallback.mjs` / `scan-orchestration-neutrality.mjs` to also check memory.**
   - ✅ One fewer scan file.
   - ❌ Conflates two distinct invariants (no-fallback / orchestration-neutrality / memory-neutrality) in one scanner —
     harder to reason about, test, and evolve independently. REJECTED (single-responsibility).
3. **Keep it a manual grep (status quo).**
   - ✅ Zero tooling.
   - ❌ The exact gap this spec closes; non-mechanical, non-deterministic, post-hoc — fails enforcement-architecture.
     REJECTED.
4. **A generic ESLint `no-restricted-syntax` rule.**
   - ✅ Integrates with lint.
   - ❌ Lint runs per-package and can't express the file-path (`MEMORY.md`/`topics`) content class cleanly; the scan set
     is the established home for cross-package structural floors. REJECTED as the sole mechanism.

### Decision

Adopt (1): a `scripts/harness/scan-memory-neutrality.mjs` over `packages/*/src` flagging (a) seeded memory-content files
(`MEMORY.md`/`memory/topics/**`) and (b) a memory-subsystem prompt/persona/instruction identifier assigned a ≥40-char
string literal, suppressed by `// allow-memory-content: <reason>` with a reason-less anti-rot; scope `packages/` only
(the surface owns prompts + content); registered in `run-all-scans.mjs` + run at GATE-VERIFY. Mirrors the
orchestration-neutrality + no-fallback scan precedents.

### Validated Recommendation

- **Reachability:** `run-all-scans.mjs` is the established scan aggregate (→ CI `scans` job) and `backlog-gate-guard`
  GATE-VERIFY already runs `harness:scan`; the new scan joins both with no new wiring. Verified against
  `scan-orchestration-neutrality.mjs` (the mirror) + `run-all-scans.mjs`.
- **Capability preservation:** the neutral reference policy (regex extractor, policy-evaluator constants, safety
  filter) stays in the library exactly as the SELFHOST-008 spec permits — v1 flags only seeded content files + long
  prompt-identifier string literals, of which there are ZERO today (verified), so nothing existing is broken.
- **Adversarial:** false-positive noise → the two classes are high-confidence (exact file-path + identifier-AND-length),
  and a legitimate edge carries `// allow-memory-content: <reason>`; scanning the surface by mistake → scope is
  `packages/` only, the surface is explicitly excluded; evasion via an odd identifier → acknowledged v1 limitation
  (seeded-content class is exact; the prompt class is a high-confidence floor, not a proof).

### Architecture Review Checklist

- [x] 영향 패키지/레이어: harness-only (`scripts/harness/scan-memory-neutrality.mjs` + `run-all-scans.mjs` + its unit
      test); no `packages/` runtime change (green on introduction — no seeded corpus + no prompt constants today).
- [x] Sibling scan 완료 — mirrors `scan-orchestration-neutrality.mjs` (closest analog) + the `scan-no-fallback.mjs`
      suppression/anti-rot convention; does NOT add a new escape-hatch mechanism style.
- [x] 대안 최소 2개 — 4 considered (dedicated scan CHOSEN; extend-existing REJECTED single-responsibility; manual
      REJECTED non-mechanical; eslint-only REJECTED can't express the content class), each Pro+Con.
- [x] 결정 근거 — mirror the neutrality-scan precedent; high-confidence classes green-on-introduction; `packages/`-only
      scope (surface owns prompts+content); enforces SELFHOST-008 neutrality + self-improving-harness north-star.

## Fallback & Degradation Declaration

**None.** This is a read-only mechanical scan; it introduces no runtime behavior, fallback, or degradation.

## Solution

Add `scripts/harness/scan-memory-neutrality.mjs` (mirroring `scan-orchestration-neutrality.mjs`): a pure
`findMemoryNeutralityFindingsInSource(src, file)` + a `findMemoryNeutralityFindings()` live-tree walk over
`packages/*/src`, flagging (1) seeded memory-content files and (2) memory-subsystem prompt/persona/instruction
identifiers assigned a ≥40-char string literal, suppressed by `// allow-memory-content: <reason>` with a reason-less
anti-rot. Register `memory-neutrality` in `run-all-scans.mjs`. Unit test the flag/suppress/anti-rot behavior + assert
the live tree is green.

## Affected Files

| File                                                              | Change                                                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `scripts/harness/scan-memory-neutrality.mjs` (new)                | v1 scan: seeded-content files + library capture-prompt string; `allow-memory-content: <reason>` suppress; anti-rot |
| `scripts/harness/__tests__/scan-memory-neutrality.test.mjs` (new) | unit tests: flag both classes, suppression, reason-less anti-rot, live-tree green                                  |
| `scripts/harness/run-all-scans.mjs`                               | register `memory-neutrality` in the scan set (→ CI `scans`; also runs at GATE-VERIFY)                              |

## Completion Criteria

- [x] TC-01: the scan flags a seeded memory-content file — a `MEMORY.md` (or `memory/topics/*.md`) fixture path under
      `packages/*/src` is reported as `seeded-memory-content` (unit test).
- [x] TC-02: the scan flags a library capture-prompt — a memory-subsystem source with a `const CAPTURE_PROMPT =
'<≥40-char sentence>'` (identifier matches prompt/persona/instruction) is reported as `library-capture-prompt`;
      an adjacent `// allow-memory-content: <reason>` suppresses it (unit test).
- [x] TC-03: no false positives — a short prompt-named token (`const promptId = 'x'`), the existing regex
      extractor/policy constants, and a `prompt` mention in a COMMENT are NOT flagged (unit test, negative fixtures).
- [x] TC-04: anti-rot (v1 = reason-less-only) — a reason-less `// allow-memory-content` fails; a well-formed
      `allow-memory-content: <reason>` passes (unit test).
- [x] TC-05: registered in `run-all-scans.mjs` and runs continuously (`pnpm harness:scan`, CI `scans`) + at GATE-VERIFY;
      `pnpm harness:scan` is GREEN on introduction (the live `packages/*/src` tree has no seeded corpus + no library
      capture prompt) — regression (whole scan set green).

## Test Plan

| TC    | Verification                                                     | Type/Tool                     |
| ----- | ---------------------------------------------------------------- | ----------------------------- |
| TC-01 | seeded `MEMORY.md`/`topics` under src flagged                    | node unit on the scan         |
| TC-02 | library capture-prompt flagged + `allow-memory-content` suppress | node unit on the scan         |
| TC-03 | no false positives (short token / reference constants / comment) | node unit (negative fixtures) |
| TC-04 | anti-rot = reason-less-only                                      | node unit on the scan         |
| TC-05 | registered; `pnpm harness:scan` green on introduction            | harness:scan regression       |

## Tasks

[`.agents/tasks/HARNESS-029.md`](../../tasks/HARNESS-029.md) — created at GATE-IMPLEMENT; TC-01..05 slices + the 3
GATE-APPROVAL implementer notes + Test Plan.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-18

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: INFRA` (valid 11-prefix value); `tags:` present (`[memory, neutrality, scan, harness, selfhost-008]`).
- Problem: concrete symptom (a P3/P4 commit adding `const CAPTURE_PROMPT = "You are …"` to `packages/agent-framework/src/memory/` or seeding a `MEMORY.md`/`topics/*.md` corpus under `src/` — nothing mechanical catches it today; only manual grep P1/P2 TC-06) + reproduction condition (becomes load-bearing at SELFHOST-008 P3/P4); no TBD/TODO/vague.
- Prior Art Research: present with valid `Waived:` line (internal-consistency mechanical floor, per research.md) citing three real in-repo precedents — `scan-orchestration-neutrality.mjs`, `scan-no-fallback.mjs`, `scan-conflict-markers.mjs` (all verified to exist); Recommendation feeds Alternatives Considered + Decision (evidence-based).
- Architecture Review Checklist: all 4 items `[x]`; Sibling scan `[x]` (mirrors `scan-orchestration-neutrality.mjs` + `scan-no-fallback.mjs` conventions); Alternatives Considered = 4 entries, each Pro+Con; Decision references the single-responsibility + high-confidence trade-off. New-surface placement: N/A — harness-only new scan script under `scripts/harness`, no new package/app/presentation surface.
- Completion Criteria: TC-01..05 all `TC-N`-prefixed, observable/command form; no banned vague language.
- Test Plan: present; 5 rows (TC-01..05) match the 5 Completion Criteria exactly; each row has non-empty Type/Tool (node unit / harness:scan regression); no `manual` rows.
- Structure: Tasks section present with placeholder; Evidence Log present and empty on this first run; no `## Status`/`## Classification` body sections.
- TC-N count matches: 5 (Completion Criteria) = 5 (Test Plan). harness:scan reported 55/55 green.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-18

**Status upgrade:** review-ready → approved

- Prior-gate precondition: `[GATE-WRITE] — ✅ PASS | 2026-07-18` present in this Evidence Log; frontmatter `status: review-ready`, file in `spec-docs/backlog/` — matches expected input stage for GATE-APPROVAL.
- User explicit approval: owner chose **"HARNESS-029 먼저"** — approving implementing this memory-neutrality scan before SELFHOST-008 P3/P4. Direct, unambiguous, directed at this spec.
- Independent design review: `proposal-reviewer` returned **ENDORSE** — all premises verified TRUE against code (the enforcement gap is real; scan is green on introduction — no seeded corpus + no ≥40-char prompt-identifier literals in the memory subsystem today; the two-class detector is high-confidence; `packages/`-only scope is correct with the surface deliberately excluded).
- New-surface placement: N/A — harness-only scan script under `scripts/harness`, not a new package/app/presentation surface; no independent placement review required.
- No Architecture Review or frontmatter `type`/`tags` modified after approval.

**Implementer notes to carry into GATE-IMPLEMENT (3 non-blocking, from proposal-reviewer):**

1. Scope class-2 (`library-capture-prompt`) deliberately to the curation subsystem (memory-path segment, `__tests__` excluded) — do not broaden.
2. Class-2 is an evadable floor (identifier + ≥40-char heuristic) backing the manual TC-06 review, not a proof; the seeded-content class (class-1) is exact. Keep the manual review in place.
3. Class-1 couples to today's `MEMORY.md` / `memory/topics/**` corpus layout; revisit the file-path patterns if the durable-corpus layout changes.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-18

**Status upgrade:** approved → in-progress

- Prior-gate precondition: `[GATE-APPROVAL] — ✅ PASS | 2026-07-18` present in this Evidence Log; frontmatter `status: approved` — matches the expected input stage for GATE-IMPLEMENT.
- Tasks file created: `.agents/tasks/HARNESS-029.md` exists.
- Path recorded in spec: `## Tasks` section references [`.agents/tasks/HARNESS-029.md`](../../tasks/HARNESS-029.md).
- Tasks map to Completion Criteria: task file has one slice per TC-N (TC-01 seeded-memory-content, TC-02 library-capture-prompt + suppress, TC-03 no false positives, TC-04 anti-rot reason-less-only, TC-05 registered + green on introduction) — 5 slices = 5 TC-N, plus the 3 GATE-APPROVAL implementer notes carried in.
- Test Plan present in task file: `## Test Plan` section (node unit on the scan + harness:scan regression) — ~600 chars, well over the ≥50-char floor. [AF-24]
- No implementation commits yet: `scripts/harness/scan-memory-neutrality.mjs` and its test do not exist; `memory-neutrality` not yet registered in `run-all-scans.mjs`; no HARNESS-029 implementation commit in git log.
