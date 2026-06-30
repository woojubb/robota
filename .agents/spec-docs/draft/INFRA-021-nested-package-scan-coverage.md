---
status: draft
type: INFRA
tags: [typescript]
---

# INFRA-021: Route one-level package scans through a nesting-aware enumerator

## Problem

Several harness scans enumerate workspace packages with a one-level `readdirSync('packages')` loop and
therefore **silently skip nested package groups** declared in `pnpm-workspace.yaml` (currently
`packages/dag-nodes/*`). The 21 `packages/dag-nodes/*` packages each ship a `docs/SPEC.md`, but these
scans never reach them — so those packages are under-covered:

- `scripts/harness/check-spec-paths.mjs`
- `scripts/harness/check-spec-public-surface.mjs`
- `scripts/harness/check-spec-publish-claims.mjs`
- `scripts/harness/scan-deprecated-markers.mjs`
- `scripts/harness/check-stub-markers.mjs`

This is the same defect class as the CI `package-dist` artifact glob (fixed) and the
`build-types-ordered.mjs` scan (fixed). The artifact sub-class is now guarded by
`check-nested-package-glob-coverage.mjs`; this item covers the harness-scan sub-class.

Reproduction: `packages/dag-nodes/input/docs/SPEC.md` exists but is not in the file set
`check-spec-paths.mjs listSpecFiles()` returns (it looks for `packages/dag-nodes/docs/SPEC.md`).

## Why this is its own change (not folded into the lesson fix)

Enabling coverage will subject 21 node-package `SPEC.md` files to validations they were never checked
against — likely surfacing a batch of new findings (path/public-surface/publish-claim mismatches) that
need remediation. That remediation is the bulk of the work and must not ride along silently inside an
unrelated fix. Tracked here per `learning-loop.md` ("Enforcement Preference": mechanize, or record an
infeasible-now reason \*\*with a tracked item").

## Proposed approach

- Add a shared nesting-aware enumerator (e.g. `listWorkspacePackageDirs(root)` in
  `scripts/harness/shared.mjs`) that resolves package directories from the `pnpm-workspace.yaml` globs,
  including nested groups (`packages/<group>/*`). Single source for "what are the workspace packages".
- Route the five scans above through it (replace the bespoke one-level `readdirSync` loops).
- Run each scan; triage and fix the node-package SPEC findings that surface.
- Extend `check-nested-package-glob-coverage.mjs` (or a sibling) to assert these scans cover nested
  groups, so the regression is mechanically caught.

## Notes

This document is a draft backlog item (pre-GATE-WRITE). Promote through the backlog pipeline when
scheduled.
