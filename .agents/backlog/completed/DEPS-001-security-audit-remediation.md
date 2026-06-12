---
title: 'DEPS-001: Security audit remediation campaign — clear pnpm audit to unblock release-grade verification'
status: done
created: 2026-06-12
priority: high
urgency: now
area: workspace
depends_on: []
---

# DEPS-001: Security audit remediation campaign

## Problem

Release PR #701 (develop → main) is blocked by the release-grade verification step
`pnpm audit --audit-level high`: 89 advisories (2 critical, 18 high, 57 moderate, 12 low)
as of 2026-06-12. The user directed full dependency remediation before releasing
(declining a publish-scope-only audit gate). Full inventory: see the audit summary below;
raw JSON regenerable via `pnpm audit --json`.

Key facts:

- prod high advisories all sit in `apps/*` dependency trees; publishable
  `packages/@robota-sdk/*` have zero high/critical prod advisories
- the single critical (vitest <3.2.6) is dev-only tooling, workspace-wide
- many advisories are stale-lockfile resolutions already inside declared ranges

## Remediation units (risk-ascending)

### U1 — semver-safe bumps + targeted overrides (highs minus majors)

- [x] `next` 15.4.1 → 15.5.19 exact-pin bump in apps/agent-web, docs, starter-nextjs, www
      (8 high + 4 moderate + 2 low advisories)
- [x] `@anthropic-ai/sdk` ^0.80.0 → ^0.91.1 (packages/agent-provider; 2 moderate)
- [x] `pnpm update -r` for in-range stale resolutions: hono ≥4.12.21, ws ≥8.20.1,
      @grpc/grpc-js ≥1.13.5 (2 high), tmp ≥0.2.6 (high+low), devalue ≥5.8.1 (high),
      astro ≥6.1.10, qs, brace-expansion, js-yaml, postcss, ip-address, smol-toml, yaml,
      mdast-util-to-hast, @protobufjs/utf8, @hono/node-server, uuid, @tootallnate/once,
      vite ≥5.4.21 (patch line)
- [x] targeted `pnpm.overrides` ONLY for out-of-range transitives (undici@<6.24.0 → >=6.24.0) that remain (e.g.
      undici ≥6.24.0 under apps/action @actions/core — 2 high + 3 moderate)
- [x] full build + test + typecheck + lint green; re-audit delta recorded:
      **89 → 9** advisories (2026-06-12: before 2 critical / 18 high / 57 moderate / 12 low →
      after 2 critical [vitest, U3] / 1 high [next-mdx-remote, U2] / 6 moderate / 0 low);
      grpc-js, protobufjs(high), tmp, devalue, ws, hono, qs and the rest cleared by in-range
      updates; firebase tree highs resolved without majors

### U2 — app dependency majors

- [x] apps/agent-server: firebase-admin ^12 → ^13 (13.10.0) / firebase-functions ^4.8 → ^7
      (7.2.5) — usage surface was a single `onRequest` from `firebase-functions/v2/https`
      (path valid in v7); server build + 19 tests green. Residual transitive
      uuid@9 (via google-auth-library > gaxios) cleared with override `uuid@<11.1.1`
- [x] apps/docs: next-mdx-remote ^5 → ^6 — `/rsc` import unchanged; docs build green
- [x] apps/blog: no residual after U1 (astro cleared by in-range update)
- [x] re-audit: 9 → 1 (after U2+U3 combined; see Final)

### U3 — vitest 1.6.1 → ≥3.2.6 workspace migration (the critical)

- [x] vitest ^1.6.1 → ^3.2.6 + @vitest/coverage-v8 ^3.2.6 across 19 package.json files;
      vite/esbuild moderates cleared with the new tree
- [x] migration fallout was minimal: zero test failures workspace-wide; two TS7006
      implicit-any params in agent-core execution-service.test.ts (vitest 3 vi.fn inference
      change) fixed with explicit annotations; no config changes required
- [x] full workspace test sweep green (all packages + apps, 0 failures); no config surface
      change → no separate spec doc needed (two-line type annotation fix only)

### Final

- [x] `pnpm audit --audit-level high` exits 0 locally (final state: 1 moderate)
- [x] residual: **1 moderate** — postcss@8.4.31 pinned INSIDE next@15.5.19 itself
      (apps/agent-web > next > postcss); not overridable without patching next's internal
      pin — waits for the next upstream release. No high/critical remain.

## Test Plan

Each unit lands as its own PR with: full `pnpm build`, full `pnpm test` (affected scopes at
minimum, workspace sweep for U3), `pnpm typecheck`, `pnpm lint`, and a before/after
`pnpm audit` severity-count delta recorded in this file. Final gate: the release PR's
release-grade verification job (which runs `pnpm audit --audit-level high`) passes.

## User Execution Test Scenarios

- Prerequisite: release PR #701 open (develop → main).
- Steps: after all units merge to develop, observe PR #701 checks.
- Expected observable result: `release-grade verification` check passes; `pnpm audit
--audit-level high` locally exits 0.
- Evidence: 2026-06-12 — PR #702 (DEPS-001 U1+U2+U3, squash-merged to develop) ran the
  full CI including the dependency-change-triggered `security audit` job: **pass**. Release
  PR #701 then re-ran `release-grade verification` (which executes
  `pnpm audit --audit-level high` + full build/test/typecheck/lint + all 22 harness scans):
  **pass**, and #701 merged to main (73fcd72f6, merge commit;
  `git merge-base --is-ancestor` confirms develop ⊂ main). Local final state:
  `pnpm audit` → 1 moderate (postcss pinned inside next@15.5.19, upstream-only), 0 high,
  0 critical — from 89 advisories (2 critical / 18 high) at campaign start.
