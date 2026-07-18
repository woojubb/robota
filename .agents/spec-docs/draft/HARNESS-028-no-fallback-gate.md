---
status: draft
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

**Recommendation (adopted below):** the three-layer design IS this common shape. Layer-1 declaration = the
ArchUnit/`ignore-known` declared manifest (fail-closed on absence). Layer-2 GATE-VERIFY = mypy `warn_unused_ignores`
/ Rust `#[expect]` reconciliation (an `allow-fallback:` with no matching declaration — or a declaration with no live
suppression — fails). Layer-3 scan = Semgrep/ESLint precision floor over `packages/`, matching ONLY `catch{return
<alt>}` and core-behavior `f()||g()`, **excluding** `??`/defaulting-`||` per the precision mandate, with a
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
  continuously and at the gate. **Annotation anti-rot** lives here too: a STALE `allow-fallback:` (no matching
  flagged pattern) and a REASON-LESS `allow-fallback:` both fail (the mypy `warn_unused_ignores` +
  `ignore-without-code` analogue — the annotation is structured/line-adjacent, so this IS mechanically computable).
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
anti-rot (mechanical, on the scan):** a stale `allow-fallback:` (no matching flagged pattern) and a reason-less
`allow-fallback:` both fail — the mypy `warn_unused_ignores`/`ignore-without-code` analogue, applicable because the
annotation is structured + line-adjacent. The scan is a **floor, not a ceiling**; free-prose declaration↔code
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

- [x] 영향 패키지/레이어: harness-only (spec-DOC convention via `backlog-writer` + `scripts/harness/scan-no-fallback.mjs` + `run-all-scans.mjs`, also run at GATE-VERIFY); no `packages/` runtime code changed (only a one-time
      annotation reason-stamp sweep of existing sites). Enforces an EXISTING rule (operational.md).
- [x] Sibling scan 완료 — mirrors the existing scan pattern (`conflict-markers`, `check-dependency-direction`,
      `orchestration-neutrality`) + the existing `allow-fallback:` annotation convention; does NOT add a new
      escape-hatch mechanism.
- [x] 대안 최소 2개 — 4 considered (three-layer CHOSEN; scan-only REJECTED context-blind; review-only REJECTED
      non-mechanical; eslint-only REJECTED doesn't close the gate loop), each Pro+Con.
- [x] 결정 근거 — spec is the authority (context-aware), gate-verify + continuous floor are the mechanical
      guardians, conservative patterns avoid noise; enforces operational.md; self-improving-harness north-star.

## Solution

Two mechanical surfaces + one review surface: (1 — review) a `## Fallback & Degradation Declaration` section
(default "None") on the gate-pipeline **spec-doc** (authored via `backlog-writer`, NOT the package `SPEC.md`
template), justified at GATE-APPROVAL by `proposal-reviewer`; (2 — floor) a conservative always-on
`scan-no-fallback.mjs` over `packages/*/src` joining `harness:scan` and also run at GATE-VERIFY — v1 detects ONLY a
`catch` block whose body returns/produces an alternative value; (3 — anti-rot on the scan) a stale or reason-less
`allow-fallback: <reason>` annotation fails (mypy `warn_unused_ignores` analogue). Explicitly EXCLUDED: `x ??
literal` and defaulting-`||` value-precedence. The `f() || g()` both-calls rule is DEFERRED behind a proven
`ruleid:`/`ok:` fixture corpus (it cannot syntactically distinguish legit lazy-init from a prohibited fallback).
The ~357 existing `allow-fallback:` sites are reason-stamped in a one-time migration so the scan passes on
introduction. Free-prose declaration↔code reconciliation stays a REVIEW judgment (not mechanized).

## Affected Files

| File                                                           | Change                                                                                                                                                                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.agents/skills/backlog-writer/SKILL.md` (spec-doc convention) | add `## Fallback & Degradation Declaration` (default "None") to the spec-DOC structure it authors — NOT the package `SPEC.md` template — + authoring guidance                                               |
| `scripts/harness/scan-no-fallback.mjs` (new)                   | v1: conservative `catch { return <alt> }` scan over `packages/*/src`; `allow-fallback: <reason>` suppression; anti-rot (stale + reason-less annotation fail); `f()\|\|g()` deferred behind a fixture corpus |
| `scripts/harness/run-all-scans.mjs`                            | register `no-fallback` in the scan set (→ CI `scans` job; also runs at GATE-VERIFY)                                                                                                                         |
| existing `allow-fallback:` sites in `packages/*/src` (~357)    | one-time migration: reason-stamp any bare annotation so the anti-rot passes on introduction                                                                                                                 |

## Completion Criteria

- [ ] TC-01: `scan-no-fallback.mjs` (v1) flags the high-confidence `catch { return <alt> }` pattern in a
      `packages/*/src` fixture and is suppressed by an adjacent `allow-fallback: <reason>` annotation (unit test on
      the scan). The `f() || g()` both-calls rule is DEFERRED (see TC below) and NOT flagged in v1.
- [ ] TC-02: the scan does NOT flag `x ?? default` / defaulting-`||` value-precedence, nor a `catch` that rethrows
      or logs-and-throws (no false positives) — fixture-based negative test.
- [ ] TC-03: the **spec-doc authoring convention** (`backlog-writer`) exposes a `## Fallback & Degradation
Declaration` section (default "None") on the gate-pipeline spec-doc (NOT the package `SPEC.md` template);
      GATE-WRITE-adjacent structure checks still pass (placement).
- [ ] TC-04: **annotation anti-rot** (the mypy `warn_unused_ignores` + `ignore-without-code` analogue, mechanical
      on the scan): a STALE `allow-fallback:` (an annotation with no matching flagged pattern on/near its line) FAILS,
      and a REASON-LESS `allow-fallback:` (no `<reason>`) FAILS — passing only when the annotation is both live and
      reasoned (unit test). (Code↔prose-declaration matching is a REVIEW judgment — proposal-reviewer at
      GATE-APPROVAL + the scan run at GATE-VERIFY — NOT a mechanical bidirectional check.)
- [ ] TC-05: the scan is registered in `run-all-scans.mjs` and runs both continuously (`pnpm harness:scan`, CI
      `scans`) and at GATE-VERIFY; a changed fallback lacking a declaration+annotation fails the gate (functional).
- [ ] TC-06 (migration): the one-time sweep reason-stamps the ~357 existing `allow-fallback:` sites (any bare ones)
      so `pnpm harness:scan` is GREEN on introduction — zero false-positive breakage (regression: whole scan set
      green). Sites already reasoned are unchanged; the sweep is bounded + listed.

## Test Plan

| TC    | Verification                                                | Type/Tool                     |
| ----- | ----------------------------------------------------------- | ----------------------------- |
| TC-01 | v1 `catch{return alt}` flag + `allow-fallback:` suppress    | node unit on the scan         |
| TC-02 | no false positive on `??`/defaulting-`\|\|`/rethrow         | node unit (negative fixture)  |
| TC-03 | spec-DOC declaration section present (backlog-writer)       | placement/structure           |
| TC-04 | annotation anti-rot (stale + reason-less fail)              | node unit on the scan         |
| TC-05 | registered in run-all-scans; runs continuous + at gate      | functional (scan set + guard) |
| TC-06 | ~357-site reason-stamp migration; full `harness:scan` green | harness:scan regression       |

## Tasks

`.agents/tasks/HARNESS-028.md` — 미생성 (GATE-APPROVAL 통과 후 생성).

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
