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

- **`.agents/templates/spec-template.md` + the SELFHOST/spec-doc convention**: a new
  `## Fallback & Degradation Declaration` section (default **"None"**) where any INTENTIONAL fallback or graceful
  degradation is declared and justified. `proposal-reviewer` judges it at GATE-APPROVAL — so an unauthorized
  fallback cannot pass the design gate.
- **`backlog-gate-guard` (GATE-VERIFY step)**: a mechanical check that the changed `packages/*/src` fallback
  patterns are a SUBSET of what the spec declared + `allow-fallback:` annotations; an undeclared fallback FAILS
  the gate (orchestrator rewinds).
- **`scripts/harness/scan-no-fallback.mjs` (new) + `run-all-scans.mjs`**: a CONTINUOUS floor over `packages/*/src`
  for the always-on / drive-by (non-spec) case, joining `pnpm harness:scan` (→ the CI `scans` job).
- **NOT** a blanket `??` ban: value-precedence defaults (`x ?? default`) are out of scope — only the policy's
  high-confidence patterns are flagged, to keep false positives near zero.

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

Adopt (1): make "fallback" a **declared + gate-verified + scanned** artifact. (a) Spec template gains a
`## Fallback & Degradation Declaration` section (default "None"), judged by `proposal-reviewer` at GATE-APPROVAL.
(b) A GATE-VERIFY step mechanically checks that changed-production fallback patterns ⊆ (declared ∪ `allow-fallback:`
annotated). (c) A conservative, always-on `scan-no-fallback.mjs` (high-confidence patterns only, `allow-fallback:`
suppression) joins `harness:scan`. The scan is a **floor, not a ceiling** — semantic judgment stays with review +
the spec declaration. Neutrality/no-fallback semantics live in the rule; the scan enforces the syntactic floor.

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

- [x] 영향 패키지/레이어: harness-only (spec template + `backlog-gate-guard` gate-verify + `scripts/harness/`
      scan + `run-all-scans.mjs`); no `packages/` runtime code. Enforces an EXISTING rule (operational.md).
- [x] Sibling scan 완료 — mirrors the existing scan pattern (`conflict-markers`, `check-dependency-direction`,
      `orchestration-neutrality`) + the existing `allow-fallback:` annotation convention; does NOT add a new
      escape-hatch mechanism.
- [x] 대안 최소 2개 — 4 considered (three-layer CHOSEN; scan-only REJECTED context-blind; review-only REJECTED
      non-mechanical; eslint-only REJECTED doesn't close the gate loop), each Pro+Con.
- [x] 결정 근거 — spec is the authority (context-aware), gate-verify + continuous floor are the mechanical
      guardians, conservative patterns avoid noise; enforces operational.md; self-improving-harness north-star.

## Solution

Three layers implementing the `No Fallback Policy` mechanically: (1) a `## Fallback & Degradation Declaration`
spec-template section (default "None") reviewed at GATE-APPROVAL; (2) a `backlog-gate-guard` GATE-VERIFY check that
changed `packages/*/src` fallback patterns are a subset of (spec-declared ∪ `allow-fallback:`-annotated); (3) a
conservative always-on `scan-no-fallback.mjs` joining `harness:scan`. Patterns detected (high-confidence only):
a `catch` block whose body returns/produces an alternative value, and `f() || g()` / `f() ?? g()` where both sides
are CALLS used as core-behavior (not `x ?? literal` value-precedence). `allow-fallback: <reason>` on the line/block
suppresses. The current repo is annotated so the scan passes on introduction (no false-positive breakage).

## Affected Files

| File                                              | Change                                                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `.agents/templates/spec-template.md`              | add `## Fallback & Degradation Declaration` (default "None") + authoring guidance                    |
| `scripts/harness/scan-no-fallback.mjs` (new)      | conservative high-confidence fallback-pattern scan over `packages/*/src`; `allow-fallback:` suppress |
| `scripts/harness/run-all-scans.mjs`               | register `no-fallback` in the scan set (→ CI `scans` job)                                            |
| `backlog-gate-guard` (GATE-VERIFY)                | verify changed-production fallback patterns ⊆ (spec declaration ∪ annotations)                       |
| existing sanctioned fallbacks in `packages/*/src` | add/normalize `allow-fallback: <reason>` annotations so the new scan passes                          |

## Completion Criteria

- [ ] TC-01: `scan-no-fallback.mjs` flags a high-confidence fallback pattern (`catch { return <alt> }`;
      `f() || g()` core-behavior) in a `packages/*/src` fixture and is suppressed by an `allow-fallback:` annotation
      (unit test on the scan).
- [ ] TC-02: the scan does NOT flag `x ?? default` value-precedence or a `catch` that rethrows / logs-and-throws
      (no false positives) — fixture-based negative test.
- [ ] TC-03: the spec template exposes a `## Fallback & Degradation Declaration` section (default "None"), and
      `scan-spec-research`/GATE-WRITE-adjacent structure checks still pass (placement).
- [ ] TC-04: GATE-VERIFY reconciles code ↔ declaration BOTH ways (mypy `warn_unused_ignores` analogue): it fails
      when a changed `packages/*/src` fallback is neither declared nor `allow-fallback:`-annotated, AND fails on a
      STALE exception (a spec Fallback Declaration with no matching live suppression) — passing only when they
      match. An `allow-fallback:` without a reason is also rejected (specific + reasoned). Functional test.
- [ ] TC-05: running `pnpm harness:scan` on the current repo PASSES after annotating the existing sanctioned
      fallbacks — the new floor introduces zero false-positive breakage (regression: the whole scan set is green).

## Test Plan

| TC    | Verification                                      | Type/Tool                    |
| ----- | ------------------------------------------------- | ---------------------------- |
| TC-01 | high-confidence flag + `allow-fallback:` suppress | node unit on the scan        |
| TC-02 | no false positive on `??`/rethrow                 | node unit (negative fixture) |
| TC-03 | spec-template declaration section present         | placement/structure          |
| TC-04 | gate-verify code↔declaration subset check         | functional (guard)           |
| TC-05 | full `harness:scan` green on the real repo        | harness:scan regression      |

## Tasks

`.agents/tasks/HARNESS-028.md` — 미생성 (GATE-APPROVAL 통과 후 생성).

## Evidence Log

- 2026-07-18 — **Drafted.** Owner raised the enforcement gap during the SELFHOST run and approved the three-layer
  design (spec-declaration + gate-verify + continuous scan floor, conservative patterns, `allow-fallback:`
  suppression). Prior-art research pending (dispatched).
  EOF
  echo "draft written"
