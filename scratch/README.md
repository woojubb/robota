# robota-scratch

A place for disposable scripts: repro probes and live checks against the workspace packages.

- `src/` contents are **gitignored** — nothing written here can be committed.
- The committed skeleton declares `workspace:*` deps on the main packages, so scripts resolve
  `@robota-sdk/*` imports without ever touching a library directory
  (pnpm ESM resolution is script-location-relative).
- Run: `pnpm --filter robota-scratch run run src/my-probe.ts`
  (or from the repo root: `pnpm exec tsx --conditions=source scratch/src/my-probe.ts`).
