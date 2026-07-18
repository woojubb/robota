---
title: 'HARNESS-027: mechanical agent-tools neutrality / third-party-dep floor'
status: todo
created: 2026-07-17
priority: medium
urgency: later
area: scripts/harness, packages/agent-tools
depends_on: ['SELFHOST-003', 'SELFHOST-010']
---

# Mechanical `agent-tools` neutrality / third-party-dependency floor

## Problem

SELFHOST-003 (codebase retrieval) keeps the neutral repo-map ranking adapter in `agent-tools` and injects the heavy
source parser as a duck-typed port + the corpus from the surface — so **no heavy retrieval/parser SDK becomes an
`agent-tools` dependency** and **no repo paths (corpus/domain content) live in the package**. This is enforced today
by a MANUAL grep/review (SELFHOST-003 TC-04): **no existing `pnpm harness:scan` rule mechanically fences
`agent-tools`' third-party dependencies** — `deps` (`check-dependency-direction.mjs`) only checks inter-workspace
direction/cycles + agent-core/agent-plugin constraints, and `interface-imports`/`interface-runtime` only cover
`agent-interface-*` packages.

Per [enforcement-architecture.md](../rules/enforcement-architecture.md) (every guardian needs a mechanical floor that
keeps firing), the neutrality of `agent-tools` should not rest on a one-time manual grep.

## Proposed

A standing `pnpm harness:scan` rule that mechanically fences `agent-tools`:

- A **dependency allowlist** for `packages/agent-tools/package.json` — fail on any new third-party (non-`@robota-sdk/*`)
  runtime dependency not on the allowlist (catches a heavy vector-store / parser / embedding SDK creeping in).
- Optionally, a **corpus/domain-content** check over `packages/agent-tools/src` (no hard-coded repo paths / domain
  identifiers) analogous to the SELFHOST-001 `orchestration-neutrality` floor.

Registered in `scripts/harness/run-all-scans.mjs`, failing-capable, with a red-fixture test in
`scripts/harness/__tests__/`.

## Notes

Filed at SELFHOST-003 GATE-APPROVAL ENDORSE (iteration 4, non-blocking note) and at P1 task-authoring time. Scope it
once SELFHOST-003 P1 lands so the allowlist reflects the real post-P1 dependency set.

SELFHOST-010 (computer-use) shares this gap: its `PageComputerDriver` reference adapter duck-types a browser page via
`IBrowserPageAdapter` and imports NO browser SDK (Playwright/Puppeteer/CDP), and no concrete target (URL/host) lives in
the package (TC-06). P1 backs this with a `computer-use/__tests__/neutrality.test.ts` unit floor, but a standing
`harness:scan` dependency-allowlist rule should also fence a heavy browser SDK from creeping into `agent-tools`. Extend
the allowlist/no-heavy-SDK scan to cover both the retrieval and computer-use neutrality invariants.
