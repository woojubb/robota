---
title: 'HARNESS-031: harden the hook-catalog drift-guard (firing-leg + guide-table coverage)'
status: done
created: 2026-07-19
priority: low
urgency: later
area: scripts/harness
depends_on: ['SELFHOST-009']
---

# Harden the hook-catalog drift-guard scan (HARNESS-031)

## Problem

`scan-hook-catalog.mjs` (SELFHOST-009) keeps `HOOK-CATALOG.md` ↔ `THookEvent` union parity airtight, but the
PR #1228 review flagged two best-effort gaps (both CONSIDER, non-blocking — filed here):

1. **Firing-site leg is heuristic.** `findFiringEvents` matches event-name literals (`return '<Event>'`, whitespace-
   tolerant literals, `fire*Hook(x, '<Event>'`) across all of `packages/`. A stray, unrelated `return 'Stop'` (or any
   event-name literal) can satisfy the "has a firing site" check even if the real `runHooks`/`fire*Hook` call was
   deleted — masking firing-site drift. (Doc↔union parity stays airtight; only the firing leg is soft.)
2. **The user guide table is not scan-covered.** `content/guide/permissions-and-hooks.md` reproduces the full 16-row
   event table (with a Blocking column), but the scan enforces parity only against `HOOK-CATALOG.md`. The exact drift
   SELFHOST-009 fixed (phantom `Notification` + 6 omissions in the guide) could silently recur there.

## Scope

- Firing leg: require the event literal to be **co-located with a `runHooks(`/`fire*Hook(` call** (or restrict the
  `return '<Event>'` mapping pattern to the known mapping file `getSubagentHookEvent`), so a stray literal cannot
  satisfy the check.
- Guide coverage: either extend `scan-hook-catalog.mjs` to also assert the guide table's event set matches the union,
  OR reduce the guide table to a link-only pointer to the `HOOK-CATALOG.md` SSOT (single catalog surface). The
  link-only option removes the second rot-prone surface entirely and is likely simpler.

## Resolution (2026-07-19)

Hardened `scan-hook-catalog.mjs` on both flagged legs (PR #1228 CONSIDERs):

- **Firing leg scoped (Leg 1):** the `return '<Event>'` firing pattern (c) now counts ONLY within the
  `getSubagentHookEvent` mapping function body (`extractFunctionBody` brace-match). A stray `return '<Event>'`
  in an unrelated file can no longer satisfy the firing check and mask a deleted `runHooks`/`fire*Hook` call.
- **Guide table covered (Leg 2):** added `parseGuideEventTable` (reads only the `| Event | Timing | …` table,
  excluding the sibling permission-MODE table) + a guide↔union parity leg in `computeCatalogDrift`
  (`guideEvents` optional; null ⇒ skip, back-compat). The exact drift SELFHOST-009 fixed (phantom
  `Notification` + omissions) now FAILs the scan on either doc surface, not just `HOOK-CATALOG.md`.

Tests: `scan-hook-catalog.test.mjs` extended to 19 (firing-scope stray-return negative, `extractFunctionBody`,
`parseGuideEventTable` mode-table exclusion, guide-parity GREEN/RED-missing/RED-phantom/null-skip). Live scan +
run-all-scans green.

## Notes

Non-blocking hardening of the SELFHOST-009 drift-guard; the doc↔union parity + the current guide/catalog content are
correct as merged. Follow the spec-gate when implemented.
