# INFRA-008 Tasks — Refresh apps-and-deployment.md

Spec: `.agents/spec-docs/todo/INFRA-008-apps-deployment-doc-refresh.md`

## Tasks

- [x] TC-01: Rewrite the Documentation Deployment mermaid in
      `.agents/specs/architecture-map/apps-and-deployment.md` to the real Next.js pipeline —
      `content/ + package/app docs` → `scripts/docs/prepare-docs.js` (`pnpm docs:build`) →
      `apps/docs` `next build` → `pagefind --site out` → `apps/docs/out` → Cloudflare Pages
      (Git from `main`) plus the manual `scripts/docs/deploy-cloudflare-pages.mjs`
      (`pnpm docs:deploy`) path. Remove the dead `copy-docs.js` / `copy-public.js` references
      and the stale `vitepress build` step. Verify with
      `rg -n 'copy-docs|copy-public|vitepress' .agents/specs/architecture-map/apps-and-deployment.md`
      returning nothing and the mermaid naming `next build`, `pagefind`, and `apps/docs/out`.
- [x] TC-02: Add hosting/topology rows for the three undocumented apps — `apps/action`
      (`@robota-sdk/action`, GitHub Action, `tsc`), `apps/starter-nextjs`
      (`@robota-sdk/starter-nextjs`, Next.js starter), and `apps/www` (`robota-www`, Next.js
      marketing site on Cloudflare Pages) — so the doc names all 7 apps. Verify with
      `rg -n 'apps/(action|starter-nextjs|www)' apps-and-deployment.md` matching each.
- [x] TC-03: Change the `apps/agent-web` deploy cell to name both Vercel (frontend) and
      Firebase/Firestore (backend), then run `pnpm harness:scan` and confirm it exits 0.

## Test Plan

Verification is mechanical and command-driven for all three criteria:

- TC-01: `rg` grep over `apps-and-deployment.md` asserts the dead `copy-docs` / `copy-public` /
  `vitepress` tokens are gone and that the refreshed docs-deployment mermaid names `next build`,
  `pagefind`, and `apps/docs/out`.
- TC-02: `rg` grep asserts a match for each of `apps/action`, `apps/starter-nextjs`, and
  `apps/www` in the topology table (the three previously-missing apps).
- TC-03: `rg` confirms the `apps/agent-web` row names both Vercel and Firebase, then
  `pnpm harness:scan` exits 0 (doc-only change; test-plans + conformance scans included).
