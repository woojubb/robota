---
status: in-progress
type: INFRA
tags: [cli, ci]
---

# INFRA-028: self-contained `@robota-sdk/agent-cli` published bundle

## Problem

`@robota-sdk/agent-cli` publishes with **external runtime dependencies** on 16 workspace
`@robota-sdk/agent-*` packages. Its bundler is configured to never bundle any workspace code
(`packages/agent-cli/tsdown.config.ts` → `deps: { neverBundle: [/^@robota-sdk\/.*/] }`), so the
published `dist/node/bin.js` contains only agent-cli's own code and resolves every `@robota-sdk/*`
dependency from `node_modules` at runtime.

Two concrete failures follow:

1. **Publish coupling / install breakage.** `npm install @robota-sdk/agent-cli` (or `npx …`) only
   works if _every_ one of the 16 workspace deps is published at a compatible version. A single
   unpublished or version-skewed member breaks the install — the observed `npx` failure.
2. **`/workflows` is silently omitted.** The DAG/workflows track (`@robota-sdk/agent-command-workflows`
   - the `dag-*` chain) is intentionally unpublished, so `startup/command-setup.ts` loads it through a
     guarded `createRequire('@robota-sdk/agent-command-workflows')` that throws in a published install →
     `/workflows` is dropped. It works only inside the monorepo.

**Reproduction:** `npm pack` agent-cli, install the tarball in an empty directory with no access to the
`@robota-sdk` workspace packages → the CLI fails to resolve its deps; even when siblings are published,
`/workflows` is absent.

**Intent (owner):** agent-cli must publish as a **completely self-contained bundle**, independent of any
other package's publish state, with `/workflows` included.

## Architecture Review

### Affected Scope

- `packages/agent-cli/tsdown.config.ts` — bundling policy for `@robota-sdk/*`.
- `packages/agent-cli/package.json` — move `@robota-sdk/*` runtime deps → build-time (devDeps); keep
  third-party npm deps as runtime deps.
- `packages/agent-cli/src/startup/command-setup.ts` — replace the guarded `createRequire` workflows
  loader with a static import (so the bundler includes it).
- `packages/agent-cli/src/__tests__/command-setup-optional-workflows.test.ts` — `/workflows` is now
  always present.
- `scripts/harness/check-publish-safety.mjs` (+ the CLI-077/"ln" boundary tests/rule) — the invariant
  changes from "0 dag/workflow deps in the published closure" to "**0 `@robota-sdk` runtime deps in the
  published agent-cli** (all bundled)".
- `packages/agent-cli/docs/SPEC.md` — document the self-contained-bundle contract.

Runtime workspace closure (verified, 16 pkgs, **no native modules**): agent-command, agent-core,
agent-executor, agent-framework, agent-interface-transport, agent-interface-tui, agent-preset,
agent-process, agent-provider, agent-session, agent-session-analytics, agent-subagent-runner,
agent-tools, agent-transport, agent-transport-tui, agent-transport-ws. The `/workflows` chain
(agent-command-workflows → dag-builder/core/framework → ~24 `dag-*`) is likewise **pure JS** (only
third-party dep is `zod`, published). `node-pty`/`better-sqlite3` appear **only as devDeps** (test
harness) and are not in the runtime closure.

### Alternatives Considered

1. **Bundle all `@robota-sdk/*` (incl. the workflows/dag chain) into agent-cli's dist; keep third-party
   npm deps declared as runtime deps (chosen).** Pro: published CLI is independent of the monorepo's
   publish state; `/workflows` ships; third-party libs (react/ink/AI-SDKs) keep their normal npm
   resolution (robust — no fighting their dynamic requires / self-`package.json` reads). Con: larger
   published artifact; must switch the workflows loader to a static import; must reconcile the
   publish-safety scan.
2. **Bundle everything, including third-party, into one zero-dependency file.** Pro: maximal
   independence (single file, empty `dependencies`). Con: `react`/`ink`/`@anthropic-ai/sdk`/`openai`
   bundle fragilely (dynamic requires, conditional exports, `package.json` reads); higher risk and
   harder to debug; marginal benefit over #1 since those packages are always publicly published.
3. **Publish the whole `dag-*` chain (~27 packages) and keep external deps.** Pro: no bundling work.
   Con: contradicts the standing "DAG stays private / not published" decision; large new public
   surface. Rejected.
4. **Status quo (external deps, `/workflows` omitted).** Rejected — does not meet the intent.

### Decision

Alternative 1. Bundle **all** `@robota-sdk/*` workspace code (including `agent-command-workflows` and
its `dag-*` chain) into agent-cli's published artifact; static-import the workflows module; remove
`@robota-sdk/*` from the published `dependencies` (they become build-time devDeps, bundled into `dist`);
keep third-party npm packages as declared runtime `dependencies`.

**Validated (wide blast radius — publish contract + every command surface):**

- **Reachability** — both published entrypoints resolve bundled code: `bin` (the CLI) and the library
  `index`. Every command module (default set + `/workflows`) is statically imported, so the bundler
  includes it; `/workflows` is now unconditionally present.
- **Capability preservation** — all existing commands keep working (same code, now inlined). The
  runtime closure has **no native modules**, so nothing is un-bundlable; the pure-JS `dag`/`workflows`
  chain bundles cleanly (verified: only `zod` third-party). `--node-file`, providers, TUI (ink/react)
  unaffected (react/ink remain external npm deps).
- **Adversarial pass** — (a) clean tarball install in an empty dir with **no** `@robota-sdk` registry
  access → CLI runs and `node_modules/@robota-sdk` is empty (nothing to resolve → no version skew);
  (b) `/workflows` present without any optional package installed; (c) third-party deps still install
  normally from the public registry; (d) the publish-safety / CLI-077 scans are updated to assert the
  new "0 `@robota-sdk` runtime deps" invariant rather than failing on the removed workspace edges.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — agent-cli is the sole published CLI; the sibling concern is the CLI-077/"ln" boundary scan + the optional-workflows test, both listed in Affected Scope
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료 (self-contained via bundling @robota-sdk; third-party stay external; no native modules in closure)

## Solution

1. **tsdown.config.ts** — stop treating `@robota-sdk/*` as external. Bundle every `@robota-sdk/*`
   import into both the `bin` and `index` outputs; keep third-party npm packages external (default).
   (Replace the `deps.neverBundle: [/^@robota-sdk\/.*/]` policy with the inverse — bundle `@robota-sdk`,
   leave everything else external.)
2. **command-setup.ts** — replace `loadOptionalWorkflowsCommandModule()`'s guarded `createRequire` with
   a direct `import { createWorkflowsCommandModule } from '@robota-sdk/agent-command-workflows'` so the
   module is statically reachable and bundled; `/workflows` is always registered.
3. **package.json** — move all `@robota-sdk/*` from `dependencies` to `devDependencies` (needed only at
   bundle time); add `@robota-sdk/agent-command-workflows` there if not already; the published
   `dependencies` retain only third-party npm packages.
4. **check-publish-safety.mjs + CLI-077/"ln" tests** — update the boundary assertion to "published
   agent-cli has **0** `@robota-sdk` runtime `dependencies`" (all bundled). Update
   `command-setup-optional-workflows.test.ts` to assert `/workflows` is always present.
5. **docs/SPEC.md** — record the self-contained-bundle publish contract.

## Affected Files

- `packages/agent-cli/tsdown.config.ts`
- `packages/agent-cli/package.json`
- `packages/agent-cli/src/startup/command-setup.ts`
- `packages/agent-cli/src/__tests__/command-setup-optional-workflows.test.ts`
- `scripts/harness/check-publish-safety.mjs` (+ CLI-077/"ln" boundary test/rule as applicable)
- `packages/agent-cli/docs/SPEC.md`

## Completion Criteria

- [x] TC-01: `pnpm --filter @robota-sdk/agent-cli build` then `npm pack` → install the tarball in an
      empty temp dir (no workspace linkage) → `node <cli-bin> --version` exits 0. **Verified:** clean
      `npm install` of the packed tgz (210 pkgs) → `robota --version` → `robota 3.0.0-beta.77`, exit 0.
- [x] TC-02: after that clean install, `node_modules/@robota-sdk/` contains **no** package other than
      agent-cli itself. **Verified:** `ls node_modules/@robota-sdk/` → `agent-cli` only; packed manifest
      `dependencies` = 22 third-party, 0 `@robota-sdk`.
- [x] TC-03: `/workflows` is registered in the published CLI. **Verified:** the installed
      `dist/node/bin.js` contains the full `workflows <list|catalog|validate|run>` implementation;
      `buildCommandSetup` unit test asserts exactly one `/workflows` module always present.
- [ ] TC-04: the built `dist/node/bin.js` contains **no static** import/require of `@robota-sdk/*`
      (`rg "(from|require\\(|import\\()['\"]@robota-sdk/" dist/node/bin.js` → 0 matches). The only
      permitted `@robota-sdk` references are string literals: the CLI's own name and the pre-existing
      guarded dev-only `--session-log` replay hook (`agent-provider-replay`, INFRA-017 — absent by
      design in published installs). **Verified:** `rg "(from|require\(|import\()['\"]@robota-sdk/"
bin.js` → 0.
- [x] TC-05: `pnpm harness:scan` exits 0 with the updated publish-safety / boundary scans green.
      **Verified:** all 45 scans pass; `check-publish-safety` check #4 (0 `@robota-sdk` runtime deps)
      green; `dep-kind` bundled-exemption reported per import.

## Test Plan

INFRA + cli/ci → process-spawn + stdout assertions and CI-smoke (`pnpm harness:scan`). Bundle-content
checks are mechanical `rg`/`ls` assertions over the built artifact and a packed clean-install.

| TC-ID | Test Type           | Tool / Approach                                                               | Notes |
| ----- | ------------------- | ----------------------------------------------------------------------------- | ----- |
| TC-01 | Integration (spawn) | `npm pack` → clean-dir install → spawn `--version`, assert exit 0             |       |
| TC-02 | Integration (fs)    | `ls node_modules/@robota-sdk` after clean install → assert only agent-cli     |       |
| TC-03 | Unit + spawn        | vitest: `buildCommandSetup` includes workflows module; spawn lists /workflows |       |
| TC-04 | CI-smoke (rg)       | `rg "@robota-sdk/" packages/agent-cli/dist/node/bin.js` → 0 matches           |       |
| TC-05 | CI-smoke            | `pnpm harness:scan` exit 0 (publish-safety + boundary updated)                |       |

## Tasks

- [ ] `.agents/tasks/INFRA-028.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

- **GATE-WRITE — PASS (2026-07-05).** All sections present; Problem has concrete symptom + reproduction; Architecture Review has 4 alternatives + validated Decision; checklist all [x]; TC-01…TC-05 command/observable form; one Test Plan row per TC (no `manual`).
- **GATE-APPROVAL — PASS (2026-07-05).** Owner chose bundle scope "@robota-sdk만 번들 (추천)" — bundle all `@robota-sdk/*` (incl. workflows/dag chain) into agent-cli's published `dist`; third-party npm packages stay declared runtime deps. Verbatim: **"@robota-sdk만 번들 (추천)"**. Implementation authorized.
- **GATE-IMPLEMENT — PASS (2026-07-05).** Task `.agents/tasks/INFRA-028.md` created. TDD: `command-setup-optional-workflows.test.ts` updated to require `/workflows` always present (red) → static import in `command-setup.ts` (green). tsdown bundles `@robota-sdk` (neverBundle removed); package.json moves 14 `@robota-sdk` → devDeps and declares the 22 bundled-closure third-party as runtime deps; `check-dep-kind.mjs` gains `BUNDLED_WORKSPACE_PACKAGES`; `check-publish-safety.mjs` gains check #4; docs/SPEC.md updated. Added root devDep `unrun` so tsdown builds under the repo's pinned Node 22.
- **GATE-VERIFY — PASS (2026-07-05).** TC-01…TC-05 all verified (see Completion Criteria). agent-cli: typecheck PASS, 155 tests pass, lint 0-errors, 45 harness scans pass, build green (Node 22 via unrun / Node 24). End-to-end clean-install proof: packed tgz → `npm install` in empty dir → runs, `/workflows` bundled, zero `@robota-sdk` siblings.
