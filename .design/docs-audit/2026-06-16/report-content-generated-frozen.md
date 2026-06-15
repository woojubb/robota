# Docs Audit Report — api-reference (generated) + v2.0.0 (frozen) (2026-06-16)

## api-reference coverage

**Covered (5 subdirs in content/api-reference/):** agent-cli, agent-core, agent-playground (PRIVATE),
agent-tool-mcp (PRIVATE), agent-tools. No top-level index. ~244–249 files.

**MISSING (16 of 19 public packages):** agent-command, agent-executor, agent-framework,
agent-interface-transport, agent-interface-tui, agent-plugin, agent-preset, agent-provider,
agent-session, **agent-session-analytics (NEW)**, agent-subagent-runner, agent-transport,
**agent-transport-{http,mcp,tui,ws} (NEW split)**. Only 3 of 5 covered dirs are actually public; 2 are
private and should not appear in public API reference. Covered set predates the beta.76 split.

**Generator wiring — ORPHANED:**

- `scripts/docs/docs-generator.js` dynamically scans `packages/*/src/index.ts` (no static list), so a
  fresh run would cover all packages — but it never reads `"private": true`, so it would wrongly
  include private packages. Per-run config: `typedoc.json` (repo root).
- The advertised `pnpm typedoc:convert` script **does not exist** in package.json; nothing invokes
  `docs-generator.js`. Task `completed/INFRA-BL-005-docs-build-diet.md` removed the convert step and
  planned to delete `content/api-reference/`, `content/v2.0.0/`, `typedoc.json`. Docs app is now
  Next.js (`apps/docs`), and both `apps/docs/src/lib/content.ts` and `sidebar.ts` set
  `EXCLUDED_DIRS = {'v2.0.0','api-reference','images','ko'}` — api-reference is neither regenerated nor
  published. The 5 dirs on disk are stale leftovers.

**Recommended fix (DECISION REQUIRED — pick one; never hand-edit generated .md):**

1. _Retire (matches INFRA-BL-005 direction):_ delete `content/api-reference/`, `docs-generator.js`,
   `typedoc.json`, and the dead `/api-reference` link in quickstart.md. **(recommended — lowest cost,
   aligns with the already-chosen Next.js diet.)**
2. _Restore & regenerate:_ re-add a `typedoc:convert` script → `node scripts/docs/docs-generator.js`,
   wire it into the build, make the generator skip `"private": true`, build an `/api-reference`
   route + remove from EXCLUDED_DIRS, regenerate all 19 public dirs.

**Concrete bug:** `content/quickstart.md:102` links to `/api-reference` ("full TypeScript API docs"),
which is in EXCLUDED_DIRS and does not render — dead link in the live site.

## v2.0.0 frozen status

- Confirmed intentional frozen archive. `content/v2.0.0/README.md`: `title: Robota SDK (v2.0.0)` +
  banner "archived documentation … for the latest, see current documentation (/)". Banner repeated in
  6 landing READMEs across 310 files.
- Excluded from live site (in EXCLUDED_DIRS of content.ts + sidebar.ts). No improper "current" links —
  only prose "Changes from v2.0.0" migration notes. **No action; do not modify.**

## Summary

api-reference is stale + orphaned (5 dirs, missing 16/19 incl. transport split + agent-session-analytics;
generator not wired into any build; app excludes it). Decision: retire (recommended) vs regenerate+rewire.
v2.0.0 is a correctly frozen archive — leave as-is. One concrete dead link: quickstart.md:102 → /api-reference.
