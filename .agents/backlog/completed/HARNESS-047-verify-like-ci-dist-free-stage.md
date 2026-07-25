---
title: 'HARNESS-047: verify-like-ci must also mirror the dist-FREE CI stage'
status: todo
created: 2026-07-25
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
