---
title: 'INFRA-045: investigate the robota-docs Cloudflare Pages build failure'
status: todo
created: 2026-07-23
priority: medium
urgency: soon
area: apps/docs, Cloudflare Pages
depends_on: []
---

# INFRA-045: robota-docs Cloudflare Pages build failing

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
