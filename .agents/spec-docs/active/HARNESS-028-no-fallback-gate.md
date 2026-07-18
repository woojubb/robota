---
status: in-progress
type: INFRA
tags: [no-fallback, enforcement, gate, scan, harness, self-improving]
---

# HARNESS-028: No-Fallback policy — spec-declared + gate-verified + mechanically scanned

## Problem

The `No Fallback Policy` ([operational.md](../../rules/operational.md)) — "a single, correct, verifiable path;
no silent `try/catch` alternatives; no `primary() || fallback()` for core behavior; retry only through an
explicit policy gate" — is currently enforced **only by human/agent code review**. There is **no mechanical
scan on production `packages/` code**: the existing `conflict-markers` scan targets only
`['AGENTS.md', '.agents/skills', '.agents/rules']` (harness prose). A prohibited fallback in a `.ts` file is
caught only if a reviewer notices it. That is a gap against the self-improving-harness north-star
([self-improving-harness-northstar](../../memory/self-improving-harness-northstar.md), enforcement-architecture:
_every guardian must be backed by a mechanical floor_). The codebase already uses an `allow-fallback:` comment
convention to annotate sanctioned exceptions — so the escape-hatch mechanism already exists; only the enforcement
is missing. (Owner-raised during the SELFHOST-005/006/007 run, 2026-07-18.)

## Prior Art Research

Mechanically enforcing "no silent fallback / single correct path" — from PRODUCT DOCS.

- **Static analysis + annotated escape hatch:** ESLint disable directives require a named rule + a human reason
  after `--` (https://eslint.org/docs/latest/use/configure/rules ;
  https://eslint-community.github.io/eslint-plugin-eslint-comments/rules/require-description.html +
  `no-unlimited-disable`); Semgrep suppresses a match with `// nosemgrep: <rule-id>` (rule-id form required,
  justification expected) and ships a built-in `ruleid:`/`ok:` test corpus
  (https://semgrep.dev/docs/ignoring-files-folders-code , https://semgrep.dev/docs/writing-rules/testing-rules);
  Rust `#[deny(x)]` (hard error) + `#[allow(x, reason="…")]` escape hatch, plus **`#[forbid(x)]`** — a deny that
  CANNOT be locally re-allowed (https://doc.rust-lang.org/rustc/lints/levels.html ;
  https://rust-lang.github.io/rfcs/2383-lint-reasons.html).
- **Architecture fitness functions:** dependency-cruiser `forbidden` rules + an `ignore-known` baseline
  (https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md); ArchUnit `FreezingArchRule`
  with a checked-in `ViolationStore` where `allowStoreCreation=false` **fails closed** when no baseline exists (no
  silent auto-accept) and `refreeze=true` is the explicit re-baseline (https://www.archunit.org/userguide/html/000_Index.html).
- **Declare-then-verify + anti-rot:** mypy `# type: ignore[code]` (`ignore-without-code` bans bare ignores) with
  **`warn_unused_ignores=true`** — a STALE suppression becomes an error
  (https://mypy.readthedocs.io/en/stable/error_codes.html); Rust `#[expect(x)]` fires
  `unfulfilled_lint_expectations` when the violation is gone. The exception annotation is itself verified.
- **Explicit-error idioms:** Rust `Result<T,E>` + `#[must_use]` (dropping an error is a compile signal), `?`
  propagates (stays terminal) while `.or_else()` fallback is explicit + visible
  (https://doc.rust-lang.org/std/result/); Go's mandatory `if err != nil`.

**Common shape (all references converge):** (1) a banned pattern matched by HIGH-CONFIDENCE syntactic/AST rules,
tuned for low false-positive noise (Semgrep/ESLint refuse to match un-provable semantics); (2) a per-occurrence
escape hatch that is **specific + reasoned + adjacent** (name the rule, carry a reason, sit on the line); (3)
anti-rot verification of the exceptions THEMSELVES (stale suppressions fail), with the strongest form (`#[forbid]`)
permitting no local escape.

**Recommendation (adopted below):** the design IS this common shape — but as a SPEC-DOC declaration (review) +
a scan floor (mechanical) + annotation anti-rot (mechanical), NOT a mechanical code↔prose reconciliation.
Layer-1 declaration = the ArchUnit/`ignore-known` declared manifest homed in the spec-DOC, judged at GATE-APPROVAL
(review — free prose cannot be mechanically reconciled against code). Anti-rot = mypy `ignore-without-code`
analogue applied to the **annotation**: a reason-less `allow-fallback:` fails. (mypy `warn_unused_ignores`'s
"stale = unused" only transfers once the scan covers ALL policy constructs; while v1 flags a NARROW set, an
annotation on a not-yet-scanned construct is INERT, not stale — so stale-detection is DEFERRED, see Completion
Criteria.) Layer-3 scan = Semgrep/ESLint precision floor over `packages/`, **v1 matching ONLY `catch{return <alt>}`**,
**excluding** `??`/defaulting-`||` per the precision mandate; core-behavior `f()||g()` deferred behind a
`ruleid:`/`ok:` fixture corpus. Refinements taken: `allow-fallback:` MUST carry a reason (specific+reasoned+
adjacent); prefer a **zero-new-dependency** ESLint `no-restricted-syntax` selector over adding Semgrep, reusing the
existing lint gate; reserve a `#[forbid]`-style no-hatch tier for future non-negotiable core paths (out of v1 scope).

## Architecture Review

### Affected Scope

- **spec-doc authoring convention (`backlog-writer` + a structure check), NOT the package `SPEC.md` template**: a
  `## Fallback & Degradation Declaration` section (default **"None"**) on the GATE-PIPELINE spec-doc (the artifact
  GATE-APPROVAL/GATE-VERIFY actually read — `.agents/spec-docs/`), where any INTENTIONAL fallback/degradation is
  declared + justified. `proposal-reviewer` judges it at GATE-APPROVAL as a **review** responsibility. (The package
  `SPEC.md` template `.agents/templates/spec-template.md` is a SEPARATE document — the durable per-package contract
  — and is explicitly NOT this artifact; a per-package registry of sanctioned fallbacks there is a distinct future
  idea, not this spec.)
- **`scripts/harness/scan-no-fallback.mjs` (new) + `run-all-scans.mjs`**: the MECHANICAL floor over `packages/*/src`
  — the continuous, always-on guardian, joining `pnpm harness:scan` (→ the CI `scans` job). It also runs AT
  GATE-VERIFY (the guard already runs the scans), so an undeclared/un-annotated fallback in changed code fails both
  continuously and at the gate. **Annotation anti-rot (v1 = reason-less-only)** lives here too: a REASON-LESS
  `allow-fallback:` fails (the mypy `ignore-without-code` analogue — the annotation is structured/line-adjacent).
  STALE-detection is DEFERRED: while v1 flags a narrow construct set, an annotation on a not-yet-scanned construct
  is INERT, not stale (the `warn_unused_ignores` "unused = stale" equivalence needs full-construct coverage first).
- **`backlog-gate-guard` (GATE-VERIFY)**: no NEW bespoke reconciliation — it already runs `harness:scan`, so the
  scan floor enforces the code side at the gate. The code↔prose-declaration match is a **review** judgment
  (proposal-reviewer at GATE-APPROVAL reads the declaration), not a claimed mechanical bidirectional check —
  because free-prose cannot be mechanically reconciled against code.
- **NOT** a blanket `??` ban: value-precedence defaults (`x ?? default`) are out of scope — only high-confidence
  patterns are flagged, to keep false positives near zero. **v1 flags `catch { return <alt> }` ONLY**; the
  `f() || g()` both-calls rule is DEFERRED behind a proven `ruleid:`/`ok:` fixture corpus (it cannot syntactically
  tell legit lazy-init `cache.get() || fetch()` from prohibited `primary() || fallback()`).

### Alternatives Considered

1. **Three-layer: spec-declaration (GATE-APPROVAL) + gate-verify (GATE-VERIFY) + continuous scan floor (CHOSEN).**
   - ✅ SPEC-AWARE: the spec is the authority on whether a fallback is an approved feature (e.g. SELFHOST-006's
     provider-fallback policy gate), so the gate passes declared/approved ones and blocks only UNDECLARED ones —
     the context-blindness that dooms a pure scan is gone. Forces design-time justification (shift-left). The
     continuous scan covers changes made outside a spec. Matches enforcement-architecture (guardian + floor) and
     the SENSE→ENFORCE→IMPROVE loop.
   - ❌ Adds a (mostly one-line "None") declaration section to every spec; the scan must be conservative to avoid
     noise.
2. **Continuous scan only (no spec declaration / gate).**
   - ✅ Simplest; always-on.
   - ❌ CONTEXT-BLIND — cannot distinguish an approved provider-fallback FEATURE from a prohibited silent fallback
     except via the `allow-fallback:` annotation, pushing annotation burden onto every legitimate case and
     inviting either false positives or reflexive suppression. No design-time justification. REJECTED as the sole
     mechanism (kept as one of the three layers).
3. **Review-only (status quo).**
   - ✅ Zero tooling; humans/agents judge semantics.
   - ❌ Non-mechanical — the exact gap this spec closes; expensive, non-deterministic, post-hoc. REJECTED.
4. **A generic ESLint custom rule only.**
   - ✅ Integrates with the existing lint gate; per-line `eslint-disable` escape hatch.
   - ❌ Lint runs per-package and does not close the spec-declaration/gate loop; the policy's semantic core (is this
     an approved policy gate?) still needs the spec+gate. Could be an implementation vehicle for the scan floor,
     but not a replacement for the three-layer design. REJECTED as the sole mechanism.

### Decision

Adopt (1), with TWO mechanical surfaces + ONE review surface (per the GATE-APPROVAL revision):
(a) **Review (Layer 1):** the gate-pipeline **spec-doc** gains a `## Fallback & Degradation Declaration` section
(default "None"), judged by `proposal-reviewer` at GATE-APPROVAL — a shift-left justification, NOT a mechanical
check. (b) **Mechanical floor (Layer 3):** a conservative, always-on `scan-no-fallback.mjs` over `packages/*/src`
flags high-confidence patterns (v1: `catch { return <alt> }` only), suppressed by an `allow-fallback: <reason>`
annotation; it joins `harness:scan` and also runs at GATE-VERIFY (the guard runs the scans). (c) **Annotation
anti-rot — v1 = reason-less-only (mechanical, on the scan):** a reason-less `allow-fallback:` fails (the mypy
`ignore-without-code` analogue). STALE-detection is DEFERRED — while v1 flags a narrow construct set, an annotation
on a not-yet-scanned construct is INERT (not stale); `warn_unused_ignores`'s "unused = stale" only holds once the
scan covers all policy constructs. The scan is a **floor, not a ceiling**; free-prose declaration↔code
reconciliation stays a REVIEW judgment (not mechanized). `x ?? default` value-precedence is excluded; the
`f() || g()` both-calls rule is deferred behind a fixture corpus.

### Validated Recommendation

- **Reachability:** the `allow-fallback:` annotation convention already exists in the codebase (e.g.
  `edit-checkpoint-store.ts` file-access edges, `interactive-session-persistence.ts` best-effort persist), so the
  suppression mechanism is proven; the scan formalizes it. GATE-VERIFY rides the existing `backlog-gate-guard`.
- **Capability preservation:** approved fallback features (SELFHOST-006 `runWithRoleFallback`, SELFHOST-007
  graceful degradation) are DECLARED in their specs / annotated, so they pass — no capability is removed.
- **Adversarial:** risk = false-positive noise eroding trust in the harness → mitigated by the conservative
  high-confidence pattern set (never `??` value-precedence) + the `allow-fallback:` escape hatch; risk = reflexive
  suppression → mitigated by requiring a REASON on the annotation and the GATE-APPROVAL declaration review.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: harness (spec-DOC convention via `backlog-writer` + `scripts/harness/scan-no-fallback.mjs` + its unit test + `run-all-scans.mjs`, also run at GATE-VERIFY). The only `packages/` touch is a bounded
      ~11-site reason-stamp of EXISTING sanctioned degradations the v1 detector surfaced (10 catch→default +
      1 prose) — pure `// allow-fallback: <reason>` comments, zero behavior change; NOT a 357-site sweep. Enforces
      an EXISTING rule (operational.md).
- [x] Sibling scan 완료 — mirrors the existing scan pattern (`conflict-markers`, `check-dependency-direction`,
      `orchestration-neutrality`) + the existing `allow-fallback:` annotation convention; does NOT add a new
      escape-hatch mechanism.
- [x] 대안 최소 2개 — 4 considered (three-layer CHOSEN; scan-only REJECTED context-blind; review-only REJECTED
      non-mechanical; eslint-only REJECTED doesn't close the gate loop), each Pro+Con.
- [x] 결정 근거 — spec is the authority (context-aware), gate-verify + continuous floor are the mechanical
      guardians, conservative patterns avoid noise; enforces operational.md; self-improving-harness north-star.

## Fallback & Degradation Declaration

**None.** This change introduces no new fallback or degradation path. The scan and its unit test add no runtime
code; the ~11 `// allow-fallback: <reason>` annotations DOCUMENT pre-existing sanctioned degradations (they do not
change behavior). The one intentional-degradation-adjacent decision — v1 flagging ONLY the swallow→default-literal
construct and DEFERRING `f() || g()` + stale-detection — is a scope boundary (recorded in Decision), not a fallback.

## Solution

Two mechanical surfaces + one review surface: (1 — review) a `## Fallback & Degradation Declaration` section
(default "None") on the gate-pipeline **spec-doc** (authored via `backlog-writer`, NOT the package `SPEC.md`
template), justified at GATE-APPROVAL by `proposal-reviewer`; (2 — floor) a conservative always-on
`scan-no-fallback.mjs` over `packages/*/src` joining `harness:scan` and also run at GATE-VERIFY — v1 detects ONLY
the high-confidence silent-fallback shape: a `catch` block whose FIRST meaningful statement returns a bare DEFAULT
LITERAL (`null`/`undefined`/`[]`/`{}`/`''`/`false`/`true`/`0`/`-1`) and which contains NO `throw` (the
swallow-and-return-default construct). This DELIBERATELY excludes error-RESULT returns (`return { ok: false }`,
error strings) so legitimate terminal error-surfacing is not flagged; (3 — anti-rot on the scan, v1 =
reason-less-only) a reason-less `allow-fallback:` fails (mypy `ignore-without-code` analogue); STALE-detection is
DEFERRED (an annotation on a not-yet-scanned construct is inert, not stale). Explicitly EXCLUDED: `x ?? literal` and
defaulting-`||` value-precedence. The `f() || g()` both-calls rule is DEFERRED behind a proven `ruleid:`/`ok:`
fixture corpus (it cannot syntactically distinguish legit lazy-init from a prohibited fallback).
On introduction the v1 detector surfaced **10** genuine un-annotated swallow→default fallbacks (all sanctioned
degradations — corrupt-JSON→undefined, `safeJsonParse`→null, verify-throws→false) plus the **1** prose mention;
each was reason-stamped with `// allow-fallback: <reason>` (the ~130 already-annotated catch-returns and the
non-catch-return annotations are inert/untouched) — a bounded ~11-site stamp, NOT a 357-site sweep. Free-prose
declaration↔code reconciliation stays a REVIEW judgment (not mechanized).

## Affected Files

| File                                                                    | Change                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.agents/skills/backlog-writer/SKILL.md` (spec-doc convention)          | add `## Fallback & Degradation Declaration` (default "None") to the spec-DOC structure it authors — NOT the package `SPEC.md` template — + authoring guidance                                                                                |
| `scripts/harness/scan-no-fallback.mjs` (new)                            | v1: high-confidence `catch { <default-literal return>, no throw }` scan over `packages/*/src`; `allow-fallback: <reason>` suppression; anti-rot = reason-less-only (stale-detection deferred); `f()\|\|g()` deferred behind a fixture corpus |
| `scripts/harness/scan-no-fallback` unit test (new)                      | `scripts/harness/__tests__/scan-no-fallback.test.mjs` — TC-01/02/04/06 (flag, suppress, precision negatives, anti-rot, live-tree green)                                                                                                      |
| `scripts/harness/run-all-scans.mjs`                                     | register `no-fallback` in the scan set (→ CI `scans` job; also runs at GATE-VERIFY)                                                                                                                                                          |
| 10 genuine un-annotated fallbacks + 1 prose mention in `packages/*/src` | reason-stamp each with `// allow-fallback: <reason>` (surfaced by the v1 detector; all sanctioned degradations) — bounded ~11 sites, NOT a 357-site sweep                                                                                    |

## Completion Criteria

- [ ] TC-01: `scan-no-fallback.mjs` (v1) flags the high-confidence `catch { return <alt> }` pattern in a
      `packages/*/src` fixture and is suppressed by an adjacent `allow-fallback: <reason>` annotation (unit test on
      the scan). The `f() || g()` both-calls rule is DEFERRED (see TC below) and NOT flagged in v1.
- [ ] TC-02: the scan does NOT flag `x ?? default` / defaulting-`||` value-precedence, nor a `catch` that rethrows
      or logs-and-throws (no false positives) — fixture-based negative test.
- [ ] TC-03: the **spec-doc authoring convention** (`backlog-writer`) exposes a `## Fallback & Degradation
Declaration` section (default "None") on the gate-pipeline spec-doc (NOT the package `SPEC.md` template);
      GATE-WRITE-adjacent structure checks still pass (placement).
- [ ] TC-04: **annotation anti-rot — v1 = REASON-LESS ONLY** (the mypy `ignore-without-code` analogue, mechanical on
      the scan): a REASON-LESS `allow-fallback:` (no `<reason>` text) FAILS. **Stale-detection is DEFERRED**: while
      v1's scan flags only a NARROW construct set (`catch{return <alt>}`), an `allow-fallback:` on a not-yet-scanned
      construct (`||`-fallback, catch-continue, best-effort) is INERT — it suppresses nothing today but is NOT stale
      (the mypy `warn_unused_ignores` "unused = stale" equivalence only holds once the scan covers ALL policy
      constructs). Stale-detection lands with the broader pattern set, scoped to fire only when a flagged construct
      loses its flag-worthy shape. Unit test: reason-less fails; a not-yet-scanned annotation does NOT fail. (Code↔
      prose-declaration matching is a REVIEW judgment — proposal-reviewer at GATE-APPROVAL — NOT mechanized.)
- [ ] TC-05: the scan is registered in `run-all-scans.mjs` and runs both continuously (`pnpm harness:scan`, CI
      `scans`) and at GATE-VERIFY (the guard re-runs the scans); a changed `catch{return <alt>}` lacking an
      `allow-fallback:` fails the gate (functional).
- [ ] TC-06 (green on introduction): with the v1 semantics (catch→default-literal flag + reason-less-only anti-rot),
      the existing `allow-fallback:` sites do NOT trip the scan — the already-annotated catch-returns and the
      non-catch-return annotations are inert (not stale). The v1 detector surfaced **10** genuine un-annotated
      swallow→default fallbacks + the **1** prose mention (`dag-nodes/llm-text/src/index.ts:44`); each was
      reason-stamped. `pnpm harness:scan` is GREEN on introduction — **55/55** (54 prior + `no-fallback`). The
      introduction is a bounded ~11-site reason-stamp verifying zero regression, NOT a 357-site sweep.

## Test Plan

| TC    | Verification                                                 | Type/Tool                     |
| ----- | ------------------------------------------------------------ | ----------------------------- |
| TC-01 | v1 `catch{return alt}` flag + `allow-fallback:` suppress     | node unit on the scan         |
| TC-02 | no false positive on `??`/defaulting-`\|\|`/rethrow          | node unit (negative fixture)  |
| TC-03 | spec-DOC declaration section present (backlog-writer)        | placement/structure           |
| TC-04 | anti-rot = reason-less-only (stale-detection deferred)       | node unit on the scan         |
| TC-05 | registered in run-all-scans; runs continuous + at gate       | functional (scan set + guard) |
| TC-06 | ~11 sites stamped (10 catch + 1 prose); `harness:scan` green | harness:scan regression       |

## Tasks

[`.agents/tasks/HARNESS-028.md`](../../tasks/HARNESS-028.md) — created at GATE-IMPLEMENT; one slice per TC-01..06
with a `## Test Plan` section.

## Evidence Log

- 2026-07-18 — **Drafted.** Owner raised the enforcement gap during the SELFHOST run and approved the three-layer
  design (spec-declaration + gate-verify + continuous scan floor, conservative patterns, `allow-fallback:`
  suppression). Prior-art research substantiated (ESLint/Semgrep/Rust/ArchUnit/mypy).
- 2026-07-18 — **GATE-APPROVAL iteration 1: REVISE, applied.** Independent proposal-reviewer punch-list:
  (1) Layer-1 declaration was mis-targeted at the package `SPEC.md` template — moved to the **spec-doc authoring
  convention** (backlog-writer + a structure check), the artifact GATE-APPROVAL/GATE-VERIFY actually read.
  (2) Layer-2 "code ⊆ spec-PROSE-declaration" is not mechanically computable — reframed the mechanical anti-rot to
  operate on the `allow-fallback:` **annotations** (stale annotation fails; reason-less annotation fails — the exact
  mypy `warn_unused_ignores` + `ignore-without-code` analogue) and demoted code↔prose reconciliation to a **review**
  responsibility (proposal-reviewer at GATE-APPROVAL + the Layer-3 scan run at GATE-VERIFY). (3) v1 ships the
  `catch { return <alt> }` pattern ONLY; the `f() || g()` both-calls rule is deferred behind a proven `ruleid:`/`ok:`
  fixture corpus (it false-positives on legit lazy-init like `cache.get() || fetch()`). (4) The ~357 existing
  `allow-fallback:` sites are a real one-time migration (reason-stamp) — added as its own TC. Re-review pending.
- 2026-07-18 — **GATE-APPROVAL iteration 2: REVISE, applied.** The iteration-1 anti-rot framing over-fired: v1's scan
  flags ONLY `catch{return <alt>}`, but ~160 existing `allow-fallback:` annotations sit on OTHER constructs
  (`||`-fallback, catch-continue, best-effort). Defining "stale = no matching flagged pattern" would flag those ~160
  as stale on introduction → RED, contradicting TC-06. Fix: **v1 anti-rot = reason-less-only** (mypy
  `ignore-without-code` analogue); an annotation on a not-yet-scanned construct is INERT, not stale, so
  stale-detection (`warn_unused_ignores` analogue) is DEFERRED until the scan covers all policy constructs. Reviewer
  confirmed only **1** bare annotation exists (`dag-nodes/llm-text/src/index.ts:44`), so TC-06 is a
  zero-regression check under the corrected semantics, not a 357-site sweep. Leftover Layer-2 prose reconciled
  throughout (Prior-Art recommendation, Affected Scope, Solution, Affected Files, TC-04/TC-06). Re-review pending.

### [GATE-WRITE] — ✅ PASS | 2026-07-18

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: INFRA` (valid 11-prefix value); `tags:` present (non-empty array) — pass.
- Problem: concrete symptom (`conflict-markers` scan targets only `AGENTS.md`/`.agents/skills`/`.agents/rules`, no mechanical floor over `packages/*` `.ts`); reproduction condition (a prohibited fallback in a `.ts` file caught only if a reviewer notices); no TBD/TODO/vague single-sentence — pass.
- Prior Art Research: `## Prior Art Research` present, substantiated with ≥1 product-doc citations (ESLint rule config + require-description, Semgrep nosemgrep/testing, Rust lint levels + RFC 2383, dependency-cruiser, ArchUnit, mypy error-codes) — no third-party source code; findings feed Alternatives/Decision via evidence-based Recommendation — pass.
- Architecture Review Checklist: all 4 items `[x]`; Sibling scan `[x]` with completion evidence (mirrors `conflict-markers`/`check-dependency-direction`/`orchestration-neutrality`); 4 Alternatives each with Pro+Con; Decision references the drove-the-choice trade-off (spec = authority/context-aware vs conservative floor to avoid noise); new-surface placement N/A (harness tooling — new scan script, not a new package/app/presentation surface or product-family boundary) — pass.
- Completion Criteria: TC-01..TC-06 all `TC-N`-prefixed; each in command/observable form; ≥1 per sub-feature; no banned vague phrases ("works correctly"/"no errors"/"implemented"/"displays correctly") — pass.
- Test Plan: `## Test Plan` present; 6 rows (TC-01..TC-06) matching the 6 Completion Criteria exactly; each row has non-empty Type/Tool; no "manual" rows requiring Notes — pass.
- Structure: `## Tasks` present with placeholder; `## Evidence Log` present (carries prior drafting + GATE-APPROVAL-iteration narrative entries — not a first run, no fabricated PASS entry); no `## Status`/`## Classification` sections in body — pass.
- TC-N count check: Completion Criteria (6) == Test Plan rows (6) — match confirmed.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-18

**Status upgrade:** review-ready → approved

- Prior-gate precondition: `### [GATE-WRITE] — ✅ PASS | 2026-07-18` entry present; frontmatter `status: review-ready` matches the expected input stage for GATE-APPROVAL — in order, pass.
- Explicit user approval (current conversation): the owner signed off on the three-layer design verbatim — **"제안대로 해"** (do as proposed) — approving the spec-declaration + gate-verify + continuous-scan-floor design. Reinforced by the owner's own refinement directive **"Fallback같은건 스펙 검증 게이트 같은게 백로그 같은데 있게 해서 fallback 이 있는지 검증하는 과정을 거치게 할수 있다"** (put fallback verification into the spec-gate/backlog process) — directs the exact approach this spec implements. Direct, unambiguous, and targeted at this design — pass.
- No Architecture Review / frontmatter type/tags modified after approval: frontmatter `type: INFRA` + `tags:` unchanged (consistent with the GATE-WRITE record); the Architecture Review refinements (GATE-APPROVAL iterations 1–2) were proposal-reviewer-driven corrections WITHIN the same approved three-layer design (Layer-1 re-homed to the spec-doc convention; anti-rot reframed to reason-less-only; `f()||g()` deferred) and aligned with the owner's refinement directive above — no bait-and-switch of the approved design — pass.
- Independent architecture validation (conditional): N/A as a hard requirement — this spec is harness-only tooling (a new `scan-no-fallback.mjs` + a `backlog-writer` spec-doc-convention section), introducing NO new package/app/presentation surface and reclassifying NO layer/product-family boundary (GATE-WRITE recorded new-surface placement N/A). Independently ALSO satisfied: an independent `proposal-reviewer` ran THREE iterations (REVISE → REVISE → **ENDORSE**); the final verdict is ENDORSE with all premises verified TRUE against source and `pnpm harness:scan` 54/54 green — pass.
- NON-COMPLIANCE trigger (implementation before gate): none — `## Tasks` records `미생성 (GATE-APPROVAL 통과 후 생성)`; no tasks file, no implementation edits/commits precede this gate — clear.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-18

**Status upgrade:** approved → in-progress

- Prior-gate precondition: `### [GATE-APPROVAL] — ✅ PASS | 2026-07-18` entry present; frontmatter `status: approved` matches the expected input stage for GATE-IMPLEMENT — in order, pass.
- Tasks file created: `.agents/tasks/HARNESS-028.md` exists and is populated (title, spec back-link, gate status, 6 slices, Test Plan, Affected Files) — pass.
- Tasks file path recorded in spec `## Tasks`: line references `[`.agents/tasks/HARNESS-028.md`](../../tasks/HARNESS-028.md)` — pass.
- One task per TC-N: the file's `## Slices` section carries exactly six tasks TC-01..TC-06, each mapping 1:1 to the six Completion Criteria (scan catch-return flag+suppress / no-false-positive / spec-doc declaration section / anti-rot reason-less-only / registration+gate wiring / green-on-introduction) — pass.
- Test Plan section ≥50 chars: the file's `## Test Plan` section (node unit tests on the scan module, structure/placement check, functional gate test, harness:scan regression) is present and well over 50 chars — pass. [AF-24]
- No implementation commits yet: `git log` shows only the two docs commits (`docs(harness-028): draft` + `docs(harness-028): apply GATE-APPROVAL revise punch-list`); no `scan-no-fallback.mjs`/`run-all-scans.mjs`/`backlog-writer` changes committed or staged — clear.

- 2026-07-18 — **Implementation note — v1 detector precision refinement (in scope).** Implementing the scan
  revealed that the literal GATE-APPROVED shape ("a `catch` block whose body returns/produces an alternative
  value") over-fires badly: 285 catch blocks in `packages/*/src` return a value with no throw, of which ~101 are
  UNANNOTATED — but the overwhelming majority are LEGITIMATE terminal error-surfacing (`return { ok: false }`,
  `return stringifyError(e)`, Result-type returns) that the No Fallback Policy explicitly BLESSES (Prior-Art
  "Explicit-error idioms"), not silent fallbacks. Flagging them would violate the precision mandate AND break
  TC-06. v1 was therefore narrowed to the high-confidence swallow→default subset: a `catch` whose FIRST meaningful
  statement returns a bare DEFAULT LITERAL (`null`/`undefined`/`[]`/`{}`/`''`/`false`/`true`/`0`/`-1`) with NO
  `throw`. This flagged 69 sites, 59 already `allow-fallback:`-annotated (the codebase already treats this exact
  shape as a fallback), leaving **10** genuine un-annotated sanctioned degradations — corrupt-config-JSON→undefined,
  `safeJsonParse`→null, provider-`validateConfig`-throws→false, absent-file→undefined/[], signature-verify-throws→
  false, malformed-usage-JSON→undefined — each reason-stamped, plus the **1** JSDoc prose mention. The reviewer's
  iteration-2 "single bare annotation" estimate counted only bare (no-colon) tokens, not the detector's live output;
  the real bounded count is ~11 zero-behavior-change annotations. Spec Solution/Affected Files/TC-06/Checklist +
  the task file reconciled to this. Not a 357-site sweep.
