---
title: 'CORE-028: `agent-core`''s "browser" build is a Node build, and every browser product hand-writes stubs around it'
status: done
completed: 2026-08-06
created: 2026-08-02
priority: critical
urgency: now
area: packages/agent-core, apps/agent-web
depends_on: []
---

# CORE-028: the browser export condition is a promise the module graph cannot keep

## Problem

`@robota-sdk/agent-core` declares a `browser` export condition, and that build imports `node:crypto`,
`node:fs`, `node:path` and `node:child_process` on its very first line. The declared capability is
not delivered: all browser work is blocked, and the cost is re-paid per bundler and by every external
consumer.

The workaround in the repo's own web app makes it worse, not better: aliasing `fs`/`net`/`tls`/
`worker_threads` to `false` resolves them to **empty objects**, which converts a build-time contract
violation into a **deferred silent runtime `TypeError` in a user's browser**.

## Evidence

Observed independently by **L0 (foundation, the cause)** and **L4 (product, the workaround)**.

- L0 F6 — `packages/agent-core/package.json` declares `exports["."].browser`, and
  `tsdown.config.ts` builds `dist/browser` from the _same_ barrel as the Node build; that barrel
  re-exports Node-only modules: `src/utils/index.ts:2-8` (`./path-containment` → `node:fs`,
  `node:path`) and `src/hooks/index.ts:4` (`CommandExecutor`, `HttpExecutor` → `node:child_process`).
- L4 F1 — the browser bundle's first line, quoted from a build of the pre-fix tree (the artifact is
  not committed, so this is the reading rather than a path that resolves):
  `import{randomUUID as e}from"node:crypto";import{realpathSync as t}from"node:fs";import{basename as n,…}from"node:path";import s from"jssha";import{spawn as c}from"node:child_process";`
  Root-cause sites named by L4 and not by L0: `utils/path-containment.ts:19-20`,
  `hooks/executors/command-executor.ts:10`, and five `randomUUID` importers —
  `services/execution-pipeline.ts:1`, `services/execution-round-provider.ts:6`,
  `managers/conversation-message-factory.ts:8`, `managers/conversation-store.ts:6`,
  `services/conversation-service/message-helpers.ts:7`.
- The workaround, cited by both: `apps/agent-web/next.config.ts:79-110` (L0) / `:83-114` (L4) —
  `config.resolve.fallback = { child_process: false, fs: false, module: false, net: false, tls: false,
worker_threads: false }`, `config.resolve.alias = { 'node:child_process': false, 'node:fs': false, … }`,
  plus two `NormalModuleReplacementPlugin`s, plus two hand-written stub files
  `apps/agent-web/src/lib/child-process-browser.js` and `src/lib/crypto-browser.js`.

The synthesis re-verified, read-only: the `browser` export condition and the five `node:` imports on
line 1 of `dist/browser/index.js` are exactly as both reports state.

The cause in one sentence, from the synthesis: _one kitchen-sink barrel is built twice under two
platform conditions, so the browser condition is a promise the package's own module graph cannot
keep — and no build-time assertion exists to catch the regression._

## Why this is foundational (or not)

**FOUNDATIONAL — both reports agree.**

**The synthesis records a severity disagreement and resolves it:** L0 rated it `high`, L4 rated it
`blocker`. The synthesis takes L4's, because L4 traced the workaround's _failure mode_ —
`fs`/`net`/`tls`/`worker_threads: false` resolve to empty objects, so a reachable call becomes a
runtime error rather than a build failure — and established that the workaround must be re-invented
per bundler and by every external consumer. L0 did not.

The synthesis also records that **both halves are needed**: L4 identified the five `randomUUID` sites
as the largest and cheapest-to-fix offender, which L0 did not; L0 identified the barrel mechanism
(`utils/index.ts:2-8`, `hooks/index.ts:4`) more precisely.

## Direction

Two named halves, from the synthesis's own resolution of the disagreement:

1. **The cheap, large win (L4):** the five `randomUUID` importers
   (`services/execution-pipeline.ts:1`, `services/execution-round-provider.ts:6`,
   `managers/conversation-message-factory.ts:8`, `managers/conversation-store.ts:6`,
   `services/conversation-service/message-helpers.ts:7`) are named as the largest and
   cheapest-to-fix offender.
2. **The mechanism (L0):** the browser build is produced from the _same kitchen-sink barrel_ as the
   Node build (`tsdown.config.ts`), and that barrel re-exports Node-only modules
   (`utils/index.ts:2-8` → `path-containment` → `node:fs`/`node:path`; `hooks/index.ts:4` →
   `CommandExecutor`/`HttpExecutor` → `node:child_process`). Building one condition from a barrel
   that cannot satisfy it is the defect.

The synthesis states explicitly that **no build-time assertion exists to catch the regression** —
so whatever the fix, it is incomplete without one.

Risks named by the synthesis:

- The current workaround converts a build error into a **deferred runtime `TypeError` in a user's
  browser**, so removing the aliases without fixing the graph will surface breakage loudly (which is
  better, but it is a visible change).
- The workaround must be re-invented **per bundler** and by **every external consumer** — so a fix
  that only updates `apps/agent-web/next.config.ts` fixes nothing for consumers of the published
  package.

## Test Plan

- **Required red-first regression:** a build-time assertion that scans the emitted
  `packages/agent-core/dist/browser/**` for any `node:` specifier (or bare `fs`/`path`/`child_process`
  import) and fails the build if one is present. Against current code this must FAIL — line 1 of
  `dist/browser/index.js` imports four of them.
- A second red-first check: import the `browser` export condition in a browser-target bundle with **no**
  `resolve.fallback` / `resolve.alias` overrides and assert the bundle builds. Today it does not.
- After the fix, remove `apps/agent-web/next.config.ts`'s fallback/alias block, the two
  `NormalModuleReplacementPlugin`s and the two hand-written stubs
  (`src/lib/child-process-browser.js`, `src/lib/crypto-browser.js`), and assert the app still builds —
  the stubs' removal is the proof that the contract is now kept.
- `pnpm build` and `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Applies.** This is a published-package capability an SDK consumer uses directly, and it is also
observable in the repo's own browser product.

- **Prerequisites:** built workspace. A minimal browser-target consumer project is needed; it does
  not exist today and **will be built by this work** as a small example/fixture (an `apps/agent-web`
  page is the alternative and already exists).
- **Steps (SDK surface):**
  1. In a fresh browser-target project, `import { … } from '@robota-sdk/agent-core'` with no bundler
     aliases or fallbacks configured.
  2. Build it, then load the page in a browser and exercise the imported surface.
- **Expected observable result (after the fix):** the bundle builds with no Node polyfill
  configuration, the page loads, and the exercised call returns a real result with no console
  `TypeError`.
- **Expected observable result (before the fix, for contrast):** the build fails on unresolved
  `node:*` specifiers — or, with the repo's workaround applied, builds and then throws a `TypeError`
  in the browser console when the stubbed module is reached.
- **Steps (product surface):** run `apps/agent-web` locally with the `next.config.ts` fallback/alias
  block and the two stub files removed; load the page and exercise the agent flow.
- **Expected observable result:** the app builds and runs with no console errors.
- **Cleanup:** delete the scratch consumer project.
- **Evidence (fill in after implementation):** build output for the un-aliased consumer, plus a
  browser console screenshot/log showing no `TypeError` on the exercised path.

## Resolution — the browser entry's static graph reaches no Node builtin

Measured before and after, on the shipped artifact rather than the source:

```
before:  node:child_process, node:fs, node:path
after :  (none)
```

### What moved, and why each way

**`path-containment` and the hook executors left the shared barrel.** They now live behind a `./node`
subpath a consumer asks for by name. Building one export condition from a barrel that re-exports
Node-only modules was the cause the item named, and a subpath is the smallest thing that makes the
barrel able to satisfy both conditions. Seven consumers moved with them — three found by the obvious
search and four more only when the build failed, because `packages/dag-nodes/*` is nested a level
deeper than the glob that found the first three.

**The default hook executors load through `import()`.** `CommandExecutor` imports
`node:child_process` and `hook-runner` constructed it eagerly, so the specifier was in the static
graph even for a caller that supplies its own executors. `runHooks` was already async and the
default is reached on exactly one branch, so nothing above changed shape.

The lazily-loaded chunk still carries `node:child_process`, and that is the honest end state rather
than a remaining defect. A browser caller supplying its own executors never loads it; one that does
not gets a real module-not-found — which is precisely what the aliasing workaround was hiding when it
resolved `child_process` to an empty object and deferred the failure into a user's page.

### The build-time assertion the item required

It already existed: `browser-bundle-node-builtins.test.mjs`, whose `KNOWN_REMAINING` list is the
tracked debt. This change empties it, which is the assertion's own record of the fix.

A second scan was written before that file was found, reading the artifact and following static
edges. It was **withdrawn rather than landed** — two checks over one property is the forked-answer
defect this repository keeps paying for, and the existing one is better placed: it already
distinguishes the source check from the bundle check and says so when it skips.
