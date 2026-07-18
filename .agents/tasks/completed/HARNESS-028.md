# HARNESS-028 — No-Fallback policy: spec-declared + gate-verified + mechanically scanned

Spec: [`.agents/spec-docs/done/HARNESS-028-no-fallback-gate.md`](../../spec-docs/done/HARNESS-028-no-fallback-gate.md)
GATE-WRITE: PASS. GATE-APPROVAL: PASS (proposal-reviewer ENDORSE, iteration 3; owner sign-off "제안대로 해").
GATE-IMPLEMENT: PASS. Implementation: DONE (all slices; `harness:scan` 55/55, harness test 14/14).

## Slices (one task per Completion Criterion)

- [x] **TC-01 — scan flags the silent catch→default fallback, suppressed by `allow-fallback:`.**
      New `scripts/harness/scan-no-fallback.mjs` over `packages/<pkg>/src`; v1 flags a `catch` whose FIRST act
      returns a bare default literal (null/undefined/[]/{}/''/false/true/0/-1) with no throw; an adjacent
      `// allow-fallback: <reason>` (leading, inline, or trailing the catch) suppresses it. Unit test: positive + 3 suppression placements.
- [x] **TC-02 — no false positives.** The scan does NOT flag `x ?? default`, defaulting-`||`, a `catch` that
      rethrows / logs-and-throws, an error-RESULT return (`{ ok: false }` / error string), nor a catch that acts
      before returning a default. Unit test (negative fixture corpus).
- [x] **TC-03 — spec-doc declaration section (Layer 1).** `backlog-writer` Spec Document File Schema gains a
      `## Fallback & Degradation Declaration` section (default "None") on the gate-pipeline spec-doc (NOT the
      package `SPEC.md` template) + authoring guide. `harness:scan` structure checks pass (55/55).
- [x] **TC-04 — annotation anti-rot, v1 = REASON-LESS ONLY.** A reason-less `allow-fallback` (no `: <reason>`)
      FAILS. Stale-detection DEFERRED — a not-yet-scanned-construct annotation is INERT, not stale. Unit test:
      reason-less fails; not-yet-scanned annotation does NOT fail.
- [x] **TC-05 — registration + gate wiring.** Registered as `no-fallback` in `scripts/harness/run-all-scans.mjs`
      → runs continuously (`pnpm harness:scan`, CI `scans`) and at GATE-VERIFY (the guard re-runs the scans).
- [x] **TC-06 — green on introduction (zero regression).** The v1 detector surfaced 10 genuine un-annotated
      swallow→default fallbacks + the 1 JSDoc prose mention; each reason-stamped (all sanctioned degradations,
      zero behavior change). `pnpm harness:scan` GREEN — 55/55 (54 prior + `no-fallback`). A bounded ~11-site
      stamp, NOT a 357-site sweep.

## Test Plan

Each TC is backed by a mechanical check:

- **Node unit tests on the scan module** (`scan-no-fallback.mjs`): positive fixture (catch-return flagged),
  negative fixture (`??` / defaulting-`||` / rethrow NOT flagged), suppression fixture (`allow-fallback:
<reason>` suppresses), anti-rot fixture (reason-less annotation fails; not-yet-scanned annotation inert).
- **Structure/placement check** for the `## Fallback & Degradation Declaration` section in `backlog-writer`.
- **Functional gate test**: registered in `run-all-scans.mjs`; `pnpm harness:scan` runs it; an un-annotated
  changed catch-return fails.
- **Regression**: `pnpm harness:scan` GREEN on introduction (whole scan set — 55/55 after registration),
  proving zero regression under the corrected v1 semantics with the ~11 surfaced sanctioned sites reason-stamped.

## Affected Files

- `scripts/harness/scan-no-fallback.mjs` (new)
- `scripts/harness/__tests__/scan-no-fallback.test.mjs` (new — 14 tests, TC-01/02/04/06)
- `scripts/harness/run-all-scans.mjs` (register the new scan)
- `.agents/skills/backlog-writer/SKILL.md` (Spec Document File Schema: add the declaration section + guide)
- 10 catch→default sites reason-stamped: `agent-core/src/context/token-usage.ts`,
  `agent-core/src/executors/local-executor.ts`, `agent-framework/src/config/config-loader.ts`,
  `agent-framework/src/context/project-detector.ts`,
  `agent-provider-openai-compatible/src/gemma/pseudo-command-envelope.ts`,
  `agent-remote-client/src/utils/transformers.ts`, `agent-remote-pairing/src/device-identity.ts`,
  `dag-adapters-local/src/file-run-draft-store.ts`, `dag-adapters-local/src/file-storage-port.ts` (×2)
- `packages/dag-nodes/llm-text/src/index.ts:44` (reason-stamp the JSDoc prose mention)
