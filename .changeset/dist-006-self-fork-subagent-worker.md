---
'@robota-sdk/agent-subagent-runner': major
'@robota-sdk/agent-cli': patch
---

**BREAKING — DIST-006: the built `robota` binary could not spawn a subagent at all.**

`/agent run` failed on every distributed build with `Subagent worker exited before result: exit code 1`. The child's real stderr was `Cannot find module '…/agent-cli/dist/node/child-process-subagent-worker.js'`. `getDefaultSubagentWorkerPath()` resolved the worker relative to its own `import.meta.url`; INFRA-028 bundles every workspace package into `agent-cli/dist/node/bin.js`, so at runtime that directory is **agent-cli's** dist, where the worker was never emitted. It worked from source, which is why nothing caught it.

**Second occurrence of one cause.** `agent-subagent-runner/tsdown.config.ts` already carried a comment naming this exact failure: _"Without this entry the file never existed, so the child-process subagent silently failed from any dist build."_ That fix put the worker next to its OWN package's bundle; bundling then moved the resolver's notion of "next to me" one package along.

**The defect was the function, not the missing file.** `getDefaultSubagentWorkerPath()` answered _"where is my worker file on disk?"_ from a library that cannot know — the answer is a property of the packaging step. Emitting the file where the resolver looks would have fixed **one of three shipped artifacts**: the npm bundle, but not the Bun single-file binaries published on every tag, nor the Electron desktop sidecar that embeds them. A compiled single-file executable has no sibling directory to emit into.

```ts
// removed — a question no library can answer
export function getDefaultSubagentWorkerPath(): string;

// now: the composition root states how to start a copy of ITSELF
export interface ISubagentWorkerEntry {
  readonly execPath: string;
  readonly args: readonly string[];
  readonly execArgv?: readonly string[];
}
```

`IChildProcessSubagentRunnerOptions.workerPath` → **`workerEntry`**, and the runner `spawn`s `execPath args… --__robota-subagent-worker` instead of forking a module path. `robota`'s own entry enters worker mode through the new `runSubagentWorkerMain()`, so **there is no second artifact and no path to get wrong**. The one seam satisfies all three shapes: a bundled Node build names the file it is executing, a `tsx` source run names the same and adds `--import tsx`, and a compiled binary names _nothing_ — `process.execPath` is the binary, and re-executing it re-enters its embedded entry.

**Per package, classified against each barrel:**

- **`agent-subagent-runner` (major)** — the barrel loses `getDefaultSubagentWorkerPath` (deleted, not renamed) and gains `SUBAGENT_WORKER_MODE_FLAG`, `isSubagentWorkerModeArgv`, `runSubagentWorkerMain`, `ISubagentWorkerEntry`. `IChildProcessSubagentRunnerOptions` renames `workerPath` → `workerEntry` and drops `execArgv` — it now has exactly one owner, on the entry descriptor. The separate `child-process-subagent-worker` bundle entry is gone.
- **`agent-cli` (patch)** — composition-root wiring only; no barrel change.

**Two things this also repairs, both found in review:**

- **The child's stderr was discarded** (`stdio: [..., 'ignore', 'ipc']`), so a worker that died before its first IPC message reported only an exit code. That is why occurrence #2 had to be diagnosed by hand. It is now captured, bounded, and appended to the error, making the next occurrence self-reporting.
- **A source run executed the BUILT worker, not the source worker**, because package `exports` resolve to `dist`. `resolveExecArgv`'s `--import tsx` branch was therefore dead code. Self-fork names the entry actually running, so source runs finally run source.

**Verified against the artifacts, not from source:** the built `dist/node/bin.js` and a real `bun --compile` single-file binary each complete the worker IPC handshake (`{type:'ready'}`), each refuse a hand-typed flag with no IPC channel (exit 2, "Silence is not success"), and the shipped bundle no longer contains the string `child-process-subagent-worker.js` — there is nothing left to look for.
