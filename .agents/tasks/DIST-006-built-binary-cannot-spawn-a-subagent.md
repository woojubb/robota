---
title: "DIST-006: the built `robota` binary cannot spawn a subagent — the worker path resolves into agent-cli's bundle, where the worker was never emitted"
status: todo
created: 2026-08-16
priority: critical
urgency: now
area: packages/agent-cli, packages/agent-subagent-runner
depends_on: []
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

- [ ] Recommendation gate on the three options above.
- [ ] Fix, red-proved against the built binary.
- [ ] Add the dist-contract floor so a third occurrence is caught mechanically.

## Blockers

- None.

## Result

Pending.
