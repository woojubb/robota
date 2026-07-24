---
title: 'NEUT-008: web-search vendor coupling → provider port (Brave endpoint out of library defaults)'
status: done
completed: 2026-07-25
created: 2026-07-25
priority: low
urgency: later
area: packages/agent-tools
depends_on: []
---

# NEUT-008: web-search provider port

## Outcome (DONE 2026-07-25)

Shipped in PR #1346 (`feat/neut-002-008-tools-sweep`): duck-typed `IWebSearchProvider` port
(`search({ query, limit }, signal) → results`) mirroring the retrieval/computer-use port precedent;
`createWebSearchTool({ provider })` composes over it with the Brave adapter
(`createBraveSearchProvider`, `builtins/brave-search-provider.ts`) as the default — the only module
holding the vendor endpoint. The tool layer carries no vendor URL literal (test-asserted) and the
missing-key error names `BRAVE_API_KEY` without the vendor signup URL. No new dependencies
(`scan-agent-tools-neutrality` allowlist untouched). Test-plan evidence: red-first
`src/__tests__/web-search-provider.test.ts` (custom provider injected ⇒ used; tool-layer
vendor-literal absence) failed pre-fix, then green with the existing `web-search-tool.test.ts`
suite unchanged.

## Problem

`agent-tools/src/builtins/web-search-tool.ts:49,65` hardcodes the Brave Search endpoint and surfaces the
Brave signup URL in model-visible errors — vendor coupling (not prompt policy) in a neutral builtin.
(2026-07-24 neutrality audit, core-tier low note.)

## What

Duck-typed search-provider port (query→results) with Brave as the default adapter wired at the composition
root (mirrors the retrieval/computer-use port pattern); error text loses the vendor URL at the library tier.

## Test Plan

Red-first: custom provider injected ⇒ used; library source contains no vendor endpoint literal
(NEUT-006-class assertion).
