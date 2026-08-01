---
title: 'INFRA-045: investigate the robota-docs Cloudflare Pages build failure'
status: done
completed: 2026-07-24
created: 2026-07-23
priority: medium
urgency: soon
area: apps/docs, Cloudflare Pages
depends_on: []
---

# INFRA-045: robota-docs Cloudflare Pages build failing

## Outcome (DONE 2026-07-24) — root cause + correction

**Root cause:** the PRE-EXISTING unbounded override `"js-yaml@3.14.2": ">=3.15.0"` re-resolved ACROSS a
major when INFRA-044 regenerated the lockfile — `gray-matter@4.0.3` (which calls the js-yaml 3 API
`yaml.safeLoad`) started receiving js-yaml 4.x, so every MDX frontmatter parse threw
`Function yaml.safeLoad is removed in js-yaml 4` and `/en` prerender failed. Same defect class as the
brace-expansion break fixed in #1284 — but #1284 only bounded the overrides INFRA-044 ADDED, not the
pre-existing unbounded ones.

**Correction of the earlier analysis:** this WAS caused by the INFRA-044 lockfile regeneration after all —
the earlier "not caused by my change" conclusion tested only the sharp revert, not the js-yaml lineage.

**Fix:** bound the override to `>=3.15.0 <4.0.0`; lockfile regen restores gray-matter → js-yaml 3.15.0
(the GHSA-52cp fixed version, so osv-scanner stays 0). Verified by a FULL local `robota-docs` build:
all 314 pages prerender + pagefind index green (dev-mode repro of the masked digest error located the
exact throw at `src/lib/content.ts:151 matter(raw)`). Latent note: `fast-xml-parser >=4.5.5` resolves 5.8.0
(pre-existing cross-major, present before this incident and not breaking — left as-is deliberately).

## Problem

The `Cloudflare Pages: robota-docs` check fails on PRs that trigger a docs rebuild (observed on INFRA-044 #1281,
which touched `pnpm-lock.yaml`). The sibling CF projects `robota` and `robota-www` build **green**; only
`robota-docs` (the Next.js docs site, `apps/docs`, `next build && pagefind --site out`) fails.

**Not caused by the INFRA-044 dependency bumps:** reverting the `sharp` 0.34→0.35 bump did NOT fix it, so the
failure is a pre-existing / environmental `robota-docs`-specific issue (Next.js build, `pagefind`, or the CF
Pages project config/Node version), not the security remediation. The CF Pages checks are intentionally NOT
required status checks (a path-filtered skip reports "missing" and would wedge the PR — owner decision), so this
did not block the merge, but the docs deploy is genuinely red and needs fixing.

## What

1. Reproduce `pnpm --filter robota-docs build` locally (full install) to determine whether the failure is in
   `next build`, `pagefind`, or the CF environment (Node version / build command / output dir).
2. Fix the root cause (dep, config, or CF project setting) so `robota-docs` deploys green again.
3. Consider whether the CF Pages docs project should build on every PR or only on `apps/docs`-affecting changes
   (path filter) to avoid noise.

## Test Plan

- `pnpm --filter robota-docs build` succeeds locally; the `robota-docs` CF Pages deployment goes green on a PR
  that touches `apps/docs`.

## User Execution Test Scenarios

- Not applicable directly (CI/deploy infra); evidence = a green `robota-docs` CF Pages deployment URL.
