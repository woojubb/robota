# INFRA-016 Tasks — Dedicated `@robota-sdk/agent-testing` package

Spec: `.agents/spec-docs/active/INFRA-016-dedicated-testing-package.md`

## Tasks

- [ ] T1 (TC-01): scaffold published `packages/agent-testing` — `package.json`
      (`@robota-sdk/agent-testing`, `prepublishOnly` hook, `publishConfig.access: public`,
      `files: [dist, src]`, repository/homepage/bugs; deps `@homebridge/node-pty-prebuilt-multiarch` +
      `tsx`), `tsconfig.json`, `tsdown.config.ts`, `src/index.ts`.
- [ ] T2 (TC-01/02): move `spawn-pty.ts` → `src/pty/spawn-pty.ts` and its self-test →
      `src/pty/__tests__/spawn-pty.test.ts`; export the harness from `src/index.ts`.
- [ ] T3 (TC-03/04): add `@robota-sdk/agent-testing` devDependency to `agent-transport-tui`; rewire the
      5 importers (`pty-driver.ts`, `*-pty-e2e.test.ts`, self-test consumers) to import from the package;
      delete the moved files; remove now-unused node-pty/tsx ownership as appropriate.
- [ ] T4 (TC-01/02): `docs/SPEC.md` + `docs/README.md`; list the package in
      `.agents/project-structure.md`.
- [ ] T5 (TC-05): `pnpm --filter @robota-sdk/agent-testing typecheck` + `build` + `test`;
      `agent-transport-tui` `test:pty` green; repo-wide typecheck; `pnpm harness:scan` 33/33.

## Test Plan

New-package build + the moved PTY self-test in its new home + the `agent-transport-tui` `test:pty`
suites as the no-regression guard + harness:scan (specs, docs-structure, publish, dist,
build-contracts, dependency-direction, project-structure). Each TC shows evidence in the spec Evidence
Log before GATE-VERIFY.
