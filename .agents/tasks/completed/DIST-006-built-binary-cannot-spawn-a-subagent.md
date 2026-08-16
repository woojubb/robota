---
title: "DIST-006: the built `robota` binary cannot spawn a subagent — the worker path resolves into agent-cli's bundle, where the worker was never emitted"
status: done
created: 2026-08-16
priority: critical
urgency: now
area: packages/agent-cli, packages/agent-subagent-runner
depends_on: []
completed: 2026-08-16
issue: https://github.com/woojubb/robota/issues/1758
---

# DIST-006: a dist build forks a worker file that is not there

## Problem

`/agent run` fails on the **built** `robota` binary with
`Subagent worker exited before result: exit code 1`. The child's real stderr is:

```
Cannot find module '…/packages/agent-cli/dist/node/child-process-subagent-worker.js'
```

`getDefaultSubagentWorkerPath()` (`agent-subagent-runner/src/worker-path-resolver.ts:5`) resolves
`join(dirname(fileURLToPath(import.meta.url)), 'child-process-subagent-worker.js')`. INFRA-028 bundles every
workspace package into `agent-cli/dist/node/bin.js`, so at runtime `import.meta.url` points at **agent-cli's**
`dist/node/`, not `agent-subagent-runner`'s. `agent-cli/tsdown.config.ts` declares only the `bin` and `index`
entries, so the worker is never emitted there. Verified: `ls packages/agent-cli/dist/node/ | grep
subagent-worker` returns nothing.

So every subagent path that goes through the default runner — which `agent-cli/src/cli.ts:277` wires
unconditionally — is dead in any distributed build. It works from source, which is why no test caught it.

## Why this is not a new class

`agent-subagent-runner/tsdown.config.ts:9-11` already carries a comment naming **this exact failure**:

> The worker is a SEPARATE entry, not bundled into index: `getDefaultSubagentWorkerPath()` forks
> `dist/node/child-process-subagent-worker.js` at runtime. **Without this entry the file never existed, so
> the child-process subagent silently failed from any dist build.**

That fix made the worker exist next to _its own_ package's bundle. The CLI bundling change then moved the
resolver's notion of "next to me" one package along, and the same failure came back — a
resolve-relative-to-`import.meta.url` assumption that no longer holds once the caller is bundled elsewhere.

## What

Stop resolving the worker path relative to the resolver's own module location, which is a fact about the
bundler rather than about the product. Options to weigh (this needs the recommendation gate, not a
guess here):

- have the composition root pass the worker path explicitly, as `IChildProcessSubagentRunnerOptions.workerPath`
  already allows, so the CLI states where its own worker is;
- emit the worker as an additional `agent-cli` bundle entry and resolve against a known-good anchor;
- resolve through `require.resolve`/package exports rather than a directory join.

Whichever is chosen, **the mechanical floor matters more than the fix**: a check that the worker file the
resolver names actually exists in every published bundle. This is the second occurrence; a third is a
question of when, not whether.

## Test Plan

- Red-first: a case that runs the **built** binary (not source) and asserts a subagent completes.
- A dist-contract check that `getDefaultSubagentWorkerPath()` resolves to a file that exists, run against
  the built tree for every package that can be a composition root.
- `pnpm harness:verify-like-ci`.

## User Execution Test Scenarios

To be authored before implementation. The surface is `robota` itself: `/agent run …` on the built binary,
which is exactly the command that fails today, so the before/after contrast is real rather than
constructed.

## Plan

- [x] Recommendation gate on the three options above. **My recommendation was REJECTED**, and the
      rejection was right. I proposed emitting the worker as an extra `agent-cli` bundle entry; the
      reviewer showed that fixes **one of three shipped artifacts**. Verified myself: Bun single-file
      binaries (`robota-{darwin-arm64,darwin-x64,linux-x64,linux-arm64,windows-x64.exe}`) publish on
      every tag via `release-bun-binaries.yml`, and `apps/agent-app/electron-builder.yml` ships one as
      an `extraResources` sidecar. A compiled single-file executable has no sibling directory, so
      there is nowhere to emit. Two further facts killed the other options: `agent-subagent-runner`
      is a **devDependency** of `agent-cli` (so the published artifact contains no
      `node_modules/@robota-sdk/*` and `require.resolve` cannot work), and the runner's built worker
      leaves `@robota-sdk/*` as external imports, so copying it produces a file whose imports do not
      resolve. The adopted design is self-fork: the composition root states how to start a copy of
      itself, and `getDefaultSubagentWorkerPath` is **deleted**.
- [x] Fix, red-proved against the built binary. `subagent-worker-entry.bintest.ts` TC-A/TC-B both go
      RED when the worker-mode dispatch is removed from `bin.ts` and the CLI is rebuilt; green with it.
- [x] Add the floor so a third occurrence is caught mechanically. The static path check the item asked
      for **no longer has a subject** — there is no path to verify, because nothing looks for a file.
      What replaced it is behavioural and build-gated: the artifact itself is asked whether its worker
      starts. TC-C additionally asserts the shipped bundle contains no `child-process-subagent-worker.js`
      string at all.

## Blockers

- None.

## Result

**Delivered.** The built binary can spawn a subagent. `getDefaultSubagentWorkerPath()` is gone rather
than corrected: it answered _"where is my worker file on disk?"_ from a library that cannot know, and
was wrong twice for that one reason. `IChildProcessSubagentRunnerOptions.workerPath` became
`workerEntry` (`execPath` + `args` + optional `execArgv`), the runner `spawn`s instead of `fork`s, and
`robota`'s own entry enters worker mode via `runSubagentWorkerMain()`.

**Measured on the artifacts, not from source** — which is the whole point, since this defect was
invisible from source:

| Artifact                                                     | Before                          | After                               |
| ------------------------------------------------------------ | ------------------------------- | ----------------------------------- |
| npm `dist/node/bin.js`                                       | resolver's path `exists: false` | worker handshake `{"type":"ready"}` |
| Bun single-file `robota-linux-x64` (built with `bun 1.3.14`) | no sibling file can exist       | worker handshake `{"type":"ready"}` |
| flag typed by hand, no IPC                                   | —                               | loud refusal, exit 2                |

The shipped bundle no longer contains the string `child-process-subagent-worker.js`.

**Two repairs found in review, both real:**

- The child's stderr was `'ignore'`, so a death before the first IPC message reported only
  `exit code 1` — which is exactly why occurrence #2 had to be bisected by hand. Now captured
  (bounded, 4 KiB tail) and appended to the error. Proved: restoring `'ignore'` turns the new test
  red with the original message.
- The unit test that existed asserted only that the resolver returned "an absolute path ending in
  `child-process-subagent-worker.js`" — a **check that could not fail on this defect**, since a
  string's shape says nothing about whether the file is there. It stayed green for the entire time
  the built binary could not spawn a subagent. Deleted with the function it guarded.

**Also corrected:** a source run executed the _built_ worker, because package `exports` resolve to
`dist` — so `resolveExecArgv`'s `--import tsx` branch was dead code. Self-fork names the entry that
is actually running, so source runs now run source.

**Sibling, not folded in:** ARCH-021 / #1777. Both descend from `ARCH-002-p22`, which moved the
worker out of the composition root — DIST-006 is the _loading_ consequence, ARCH-021 the
_composition_ one. The worker still rebuilds providers and tools from imported defaults; that is
#1777's subject and is untouched here.

**Not covered, stated rather than implied:** this proves the worker process _starts_ on every
artifact. A full end-to-end subagent run on the built binary additionally needs a model provider in
the child, which `--session-log` does not reach (it is injected into the parent only). That gap
belongs with the Bun/desktop behavioural-coverage item, not here.
