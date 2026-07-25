---
title: 'HARNESS-047: verify-like-ci must also mirror the dist-FREE CI stage'
status: done
created: 2026-07-25
completed: 2026-07-25
priority: medium
urgency: soon
area: scripts/harness
depends_on: [HARNESS-045]
---

# HARNESS-047: mirror the dist-free half of CI too

## Problem

`pnpm harness:verify-like-ci` (HARNESS-045, #1384) closed the "local green ≠ CI green" gap in ONE
direction: it hard-fails when `dist/` is missing, because the build-dependent scans silently no-op on
an unbuilt tree. Correct — but the inverse blind spot is now live and was hit the same day.

CI's `scans` job runs the **dist-independent** suite on a **fresh checkout with no `dist/` at all**.
`check-harness-config-paths.mjs` flags a quoted workspace path that does not resolve from the repo
root — so a hardcoded `packages/<pkg>/dist/node/index.js` literal is a GHOST path in CI, but resolves
fine locally in any worktree that has been built. That is exactly how HARNESS-024 (#1381) passed a
full local `run-all-scans` and then failed CI:

```
harness config path scan failed — stale hardcoded paths:
  - scripts/harness/live-provider-smoke.mjs:289 → packages/agent-provider-defaults/dist/node/index.js
  - scripts/harness/live-provider-smoke.mjs:291 → packages/agent-core/dist/node/index.js
```

`verify-like-ci` as built REQUIRES a built tree, so it cannot reproduce this class. Mirroring CI here
means running the dist-independent scans against a build-output-free tree — not merely running the
same command on the developer's tree.

## What

Add a `scan-suite-dist-free` stage (or split the existing `scan-suite`) that runs the dist-independent
scan set with the build outputs made invisible — e.g. against a temporary clean checkout/export of the
working tree, or with the dist dirs temporarily hidden — mirroring ci.yml's `scans` job exactly, while
the existing built-tree stage keeps mirroring `quality`. Both must run; neither replaces the other.
Keep runtime tolerable (a git `worktree add --detach` of HEAD + the changed files, or an
`export`-style copy, is likely cheaper than a full clone).

## Test Plan

Red-first: plant a `packages/<pkg>/dist/...` literal in a harness script on a BUILT tree — the current
`verify-like-ci` PASSES (reproduce the #1381 miss), the new dist-free stage FAILS with the
`harness-config-paths` finding; remove the literal → both pass. Confirm the built-tree stage still
catches the HARNESS-045 baseline-tightness and missing-dist cases (no regression of that coverage).

## User Execution Test Scenarios

- Not applicable (harness / CI-parity check; no runnable user-facing behavior). Evidence: the
  agent-run red/green pairs below, produced with the real entry point on this branch.

## Outcome (done 2026-07-25)

**Built:** a fifth stage, `scan-suite-dist-free`, in `scripts/harness/verify-like-ci.mjs`, running
between the built-tree `scan-suite` and `typecheck`. The stage table now mirrors BOTH CI scan halves:

| Stage                  | Mirrors                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `scan-suite`           | ci.yml → `quality` "Build-output contracts scan" (dist restored) + the full suite    |
| `scan-suite-dist-free` | ci.yml → `scans` → "Harness scan suite (dist-independent)" (fresh checkout, no dist) |

**Mechanism (dist-free tree).** A detached `git worktree add --detach <tmp> HEAD`, then the
uncommitted diff (`git diff HEAD --binary` → `git apply`) and the untracked files copied in, then the
existing installs symlinked (root + every package `node_modules`). `dist/` is never checked in, so it
is absent **by construction** rather than by deletion — the developer's real tree is never mutated.
The borrowed `node_modules` symlinks are unlinked BEFORE `git worktree remove --force`, so the removal
can never reach the real installs; a cleanup failure prints an actionable leftover notice.

- **Runtime cost: ~5s total** (worktree add ~0.3s, 103 symlinks ~0.05s, 60 scans ~4.6s at the suite's
  own concurrency). No install, no clone, no copy of `dist`/`node_modules`.
- The skip set (`--skip dist --skip build-contracts`) is **parsed out of `.github/workflows/ci.yml`**,
  not hardcoded — hardcoding it would re-create the very drift the stage exists to catch. A workflow
  with no such step, or with two of them, is a loud error, never an assumed default.

### Red/green evidence (agent-run, this branch, built tree)

**The new catch — a ghost `dist` path literal (the #1381 miss).** Planted a string constant naming
the built `dist/node/index.js` entry of `@robota-sdk/agent-provider-defaults` (present on this built
tree, absent in any fresh checkout) in a harness script — the exact shape #1381 shipped:

- RED (the miss reproduced) — `node scripts/harness/verify-like-ci.mjs --only scan-suite`:

  ```
  all 62 scans passed

  verify-like-ci summary:
  ✓ scan-suite — full suite incl. build-contracts + dist (built tree)
  PASS — all 1 CI-mirroring stage(s) passed.
  ```

- GREEN (the new stage catches it) — `node scripts/harness/verify-like-ci.mjs --only scan-suite-dist-free`:

  ```
  ----- harness-config-paths (FAILED) -----
  harness config path scan failed — stale hardcoded paths:
    - scripts/harness/verify-like-ci.mjs:66 → packages/agent-provider-defaults/dist/node/index.js <!-- evidence-superseded: the flagged token is the deliberately planted red-first probe (a build output, never tracked), reverted in the same PR — the durable proof is this stage's own catch -->
  Update the hardcoded path after a relocation, or derive the package list dynamically.
  ...
  1 of 60 scans failed

  verify-like-ci summary:
  ✗ scan-suite-dist-free — dist-free worktree of HEAD+changes, skips: dist, build-contracts
  FAIL — 1 of 1 stage(s) failed: scan-suite-dist-free
    scan-suite-dist-free mirrors ci.yml → scans → "Harness scan suite (dist-independent)" (fresh checkout, no dist/)
  ```

  (The literal was an UNCOMMITTED working-tree edit, so this also proves the diff-apply step: the
  dist-free tree carries the branch's pending changes, not just HEAD.)

- After removing the literal, both stages pass:

  ```
  ✓ scan-suite — full suite incl. build-contracts + dist (built tree)
  ✓ scan-suite-dist-free — dist-free worktree of HEAD+changes, skips: dist, build-contracts
  PASS — all 2 CI-mirroring stage(s) passed.
  ```

**No regression of HARNESS-045's coverage.**

- _Baseline tightness_ — raised `@robota-sdk/agent-cli` in the spec-surface baseline from 1 to 4 (the
  package then sits below its frozen baseline). `run-all-scans` → **"all 62 scans passed"**, while
  `--only harness-self-test` → **FAIL**: `check-spec-public-surface.test.mjs:161
expect(notices).toEqual([])`, `1 failed | 791 passed`. Baseline restored.
- _Missing `dist`_ — temporarily moved `packages/agent-core/dist` aside; `--only scan-suite` →
  **FAIL**, `[scan-suite] BLOCKED: 1 package(s) have no dist/ … Missing: packages/agent-core`,
  `✗ scan-suite — dist missing for 1 package(s) — run pnpm build`. `dist` restored.

**Full foreground verification** on the clean built tree — `pnpm harness:verify-like-ci`:

```
✓ harness-self-test
✓ format-check — 2 changed file(s) vs origin/develop
✓ scan-suite — full suite incl. build-contracts + dist (built tree)
✓ scan-suite-dist-free — dist-free worktree of HEAD+changes, skips: dist, build-contracts
✓ typecheck
PASS — all 5 CI-mirroring stage(s) passed.
```

Unit suite: `scripts/harness/__tests__/verify-like-ci.test.mjs` 32 passed (23 → 32; +9 for the
ci.yml-derived skip set and the `node_modules` owner walk), `pnpm harness:test` green.

## Related

- **HARNESS-045** — the entry this extends (the built-tree half of the same parity gate).
- **HARNESS-024 / #1381** — the incident this stage would have caught before push.
