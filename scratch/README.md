# robota-scratch

The ONE home for disposable **live-verification scripts** (backlog User Execution evidence runs,
repro probes). See `.agents/rules/backlog-execution.md`.

- `src/` contents are **gitignored** — nothing written here can be committed.
- The committed skeleton declares `workspace:*` deps on the main packages, so scripts resolve
  `@robota-sdk/*` imports without ever touching a library directory
  (pnpm ESM resolution is script-location-relative).
- Run: `pnpm --filter robota-scratch run run src/my-probe.ts`
  (or from the repo root: `pnpm exec tsx --conditions=source scratch/src/my-probe.ts`).
- A harness scan (`temp-script-placement`) fails if temp-pattern files
  (`*-user-execution.*`, `*-proxy.mjs`, `*-mode.txt`) appear under `packages/**` or `apps/**`.
