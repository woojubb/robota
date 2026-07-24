---
title: 'NEUT-008: web-search vendor coupling → provider port (Brave endpoint out of library defaults)'
status: todo
created: 2026-07-25
priority: low
urgency: later
area: packages/agent-tools
depends_on: []
---

# NEUT-008: web-search provider port

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
