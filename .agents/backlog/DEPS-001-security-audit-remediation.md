---
title: 'DEPS-001: Security audit remediation campaign — clear pnpm audit to unblock release-grade verification'
status: todo
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

- [ ] `next` 15.4.1 → ≥15.5.18 exact-pin bump in apps/agent-web, docs, starter-nextjs, www
      (8 high + 4 moderate + 2 low advisories)
- [ ] `@anthropic-ai/sdk` ^0.80.0 → ^0.91.1 (packages/agent-provider; 2 moderate)
- [ ] `pnpm update -r` for in-range stale resolutions: hono ≥4.12.21, ws ≥8.20.1,
      @grpc/grpc-js ≥1.13.5 (2 high), tmp ≥0.2.6 (high+low), devalue ≥5.8.1 (high),
      astro ≥6.1.10, qs, brace-expansion, js-yaml, postcss, ip-address, smol-toml, yaml,
      mdast-util-to-hast, @protobufjs/utf8, @hono/node-server, uuid, @tootallnate/once,
      vite ≥5.4.21 (patch line)
- [ ] targeted `pnpm.overrides` ONLY for out-of-range transitives that remain (e.g.
      undici ≥6.24.0 under apps/action @actions/core — 2 high + 3 moderate)
- [ ] full build + test + typecheck + lint green; re-audit and record the delta

### U2 — app dependency majors

- [ ] apps/agent-server: firebase-admin ^12 → 13.x / firebase-functions ^4.8 → latest —
      clears protobufjs ≥8.0.2 (4 high + 4 moderate), fast-xml-parser ≥5.7.0, uuid ≥11.1.1,
      @grpc residuals; verify server build + tests
- [ ] apps/docs: next-mdx-remote ^5 → ^6 (high, arbitrary code execution) — verify docs build
- [ ] apps/blog: astro majors if any residual after U1
- [ ] re-audit and record the delta

### U3 — vitest 1.6.1 → ≥3.2.6 workspace migration (the critical)

- [ ] vitest + @vitest/coverage-v8 major bump across the workspace (~30 projects); vite
      peer alignment (5.4 patch line or 6.x per vitest 3 requirements); esbuild moderate
      clears with it
- [ ] migration notes: workspace config API changes, mock typing changes (vi.fn generics
      used in agent-cli tests), reporter/coverage config
- [ ] full workspace test sweep green; this unit likely needs its own spec doc if config
      surface changes (SPEC-GATE applies to test-infra .ts changes)

### Final

- [ ] `pnpm audit --audit-level high` exits 0 → release-grade verification green on PR #701
- [ ] residual moderate/low advisories recorded here with reasons if unfixable

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
- Evidence: (fill after implementation)
