# INFRA-028: self-contained `@robota-sdk/agent-cli` published bundle

- **Status:** completed
- **Completed:** 2026-07-05 (#983 → develop → main #984)
- **Spec:** `.agents/spec-docs/done/INFRA-028-self-contained-agent-cli-bundle.md`
- **Branch:** `feat/agent-cli-self-contained-bundle`
- **Approved:** 2026-07-05 (owner "@robota-sdk만 번들 (추천)")

## Goal

Publish `@robota-sdk/agent-cli` as a self-contained bundle: all `@robota-sdk/*` workspace code
(incl. the `/workflows` + `dag-*` chain) compiled into `dist`; third-party npm packages stay declared
runtime `dependencies`; zero `@robota-sdk` runtime deps in the published package. `/workflows` ships.

## Plan

1. `tsdown.config.ts` — remove `deps.neverBundle: [/^@robota-sdk\/.*/]` so `@robota-sdk/*` (now devDeps)
   are bundled; third-party (in `dependencies`) stay external.
2. `package.json` — move all `@robota-sdk/*` runtime deps → `devDependencies`; ensure ALL transitively
   used third-party packages are listed in `dependencies` (so they externalize, not bundle).
3. `startup/command-setup.ts` — static import of `createWorkflowsCommandModule`.
4. Tests — `command-setup-optional-workflows.test.ts`: `/workflows` always present.
5. `scripts/harness/check-publish-safety.mjs` (+ CLI-077/"ln" boundary) — assert 0 `@robota-sdk`
   runtime deps in agent-cli.
6. `docs/SPEC.md` — self-contained-bundle contract.

## Test Plan

TC-01..05 in the spec: clean-install runs; 0 sibling `@robota-sdk` in node_modules; `/workflows`
present; `dist/node/bin.js` has no `@robota-sdk/` import; `pnpm harness:scan` green.
