---
title: 'INFRA-161: contain the browser bundle break in the CLI web package'
issue: https://github.com/woojubb/robota/issues/2579
status: todo
created: 2026-09-05
priority: high
urgency: now
area: packages/agent-cli-web, packages/agent-transport-protocol
depends_on: []
---

# INFRA-161: contain the browser bundle break in the CLI web package

## Lane

`Lane: L1`. The diff touches `packages/agent-transport-protocol/src/browser.ts` (`packages/*/src/**`,
an L1 row) and `packages/agent-cli-web/vite.config.ts` (tooling configuration outside every L2 row,
so L0). The floor is the higher of the two.

The package's `exports` map is deliberately NOT touched. Naming a browser entry there is a published
contract change, which `.agents/rules/backlog-execution.md` § "Never inside any class" item 2 places
outside every delegated approval. That change is INFRA-158 and it waits on the owner.

## Problem

`pnpm --filter @robota-sdk/agent-cli-web build` fails:

```
../agent-transport-protocol/dist/node/index.js (1:23): "randomBytes" is not exported by
"__vite-browser-external", imported by "../agent-transport-protocol/dist/node/index.js".
```

The chain, read off the tree rather than inferred:

- `agent-cli-web` depends on `@robota-sdk/agent-transport-gui`.
- `agent-transport-gui/src/client/ws-session-client.ts` imports the runtime values `decodeFrame` and
  `decodeServerMessage` from `@robota-sdk/agent-transport-protocol`.
- That package declares one `.` export condition and every branch of it resolves to `dist/node`.
- Its barrel re-exports `admission` and the handoff manifest, and those two modules — and only those
  two — import `node:crypto`.

So a browser consumer receives the Node bundle. The build fails on the builtin rather than on the
import that asked for it, which is why the message names `randomBytes` and not the GUI client.

This blocks every unit that makes `agent-cli` an affected package, because the CLI build runs the web
build. It is not caused by any of those units.

## Plan

- [ ] Add the browser-safe barrel to the protocol package's source: everything the `.` barrel exports
      except the two modules that reach `node:crypto`, read off the actual import graph.
- [ ] Point the SPA bundler at it with a resolve alias in the private consumer, and state in the
      comment that this is the containment and INFRA-158 is the fix.
- [ ] Record that consumers outside this repository still receive the Node bundle until INFRA-158
      lands.

## Test Plan

| TC    | What it checks                             | Test Type | Tool/Approach                                                                        |
| ----- | ------------------------------------------ | --------- | ------------------------------------------------------------------------------------ |
| TC-01 | the web package builds                     | Command   | `pnpm --filter @robota-sdk/agent-cli-web build` exits 0                              |
| TC-02 | the browser barrel reaches no Node builtin | Command   | `node scripts/harness/scan-browser-package-node-subpath.mjs` exits 0                 |
| TC-03 | the published node entry is unchanged      | Command   | `git diff origin/develop -- packages/agent-transport-protocol/package.json` is empty |

## Completion Criteria

- [ ] TC-01: `pnpm --filter @robota-sdk/agent-cli-web build` exits 0 and writes `dist/index.html`.
- [ ] TC-02: the browser-entry scan exits 0.
- [ ] TC-03: the protocol package's `package.json` carries no diff against `origin/develop`.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** nothing a person can see changes. The monitor page renders the same screens with the same
text, the same commands accept the same flags, and no message, default or stored file differs before
and after. There is no step a person could be asked to run whose outcome would tell them apart.

## Tasks

`.agents/spec-docs/todo/INFRA-161-contain-the-browser-bundle-break-in-the-cli-web-package.md`

## Evidence Log
