---
'@robota-sdk/agent-executor': major
'@robota-sdk/agent-framework': major
'@robota-sdk/agent-subagent-runner': major
'@robota-sdk/agent-interface-transport': minor
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-cli': patch
---

**BREAKING — ARCH-031: the subagent seam is derived from its transport SSOT instead of copied.**

One field family — what a subagent job IS — was declared three times as independent shapes and carried
between them by six hand-written object literals that nothing checked for totality. A field added to
either side had to be hand-copied at every hop, and a miss compiled clean as a silent no-op. TYPE-003
named this cause and derived one hop; the next two changes each dropped a field at a hop it had skipped
(CORE-025's permission policy, and ANALYTICS-001's `usage`, dropped in the very commit that added it).

```ts
// now, in @robota-sdk/agent-interface-transport
export type ISubagentSpawnRequest = Omit<IAgentBackgroundTaskRequest, 'kind'>;
export type ISubagentJobResult = Omit<IBackgroundTaskResult, 'kind' | 'exitCode' | 'signalCode'>;
```

All four projections collapse to spreads. `parentTaskId` and `providerProfile` now reach the runner
because they exist on the source, not because someone remembered them.

**Per package, classified against each barrel:**

- **`agent-executor` (major)** — the barrel loses `ISubagentSpawnRequest` and `ISubagentJobResult` (they
  moved to their owner; re-publishing them here would be a pass-through re-export). `ISubagentJobStart`
  and `ISubagentJobHandle` rename `jobId` → `taskId`, `ISubagentJobStart` gains `worktree?`, and
  `ISubagentWorktreePrepareRequest` renames `jobId` → `taskId`.
- **`agent-framework` (major)** — the barrel loses eleven type-only re-exports of `agent-executor`-owned
  types. They carried zero runtime values, so they bought none of the assembly convenience a runtime
  facade exists for, while making one field family look like it had three owners. Separately,
  `ISpawnAgentTaskRequest.permissionPolicy` goes optional → **required**.
- **`agent-subagent-runner` (major)** — `ISubagentWorkerStartPayload` renames `jobId` → `taskId` and gains
  `worktree?`. This package is not in the item's declared `area:`; the audit that caught it is the reason
  it is here.
- **`agent-interface-transport` (minor)** — two new barrel exports; nothing removed or renamed.
- **`agent-core` (minor)** — **two** new barrel exports. `DEFAULT_BACKGROUND_PERMISSION_POLICY` is the
  intended one; collapsing the hand-listed permissions block to `export *` also surfaced
  `clearRegisteredToolArgumentKeys`, which the old list had omitted. It is documented as public rather
  than re-narrowed — a barrel that cannot fall out of step with its owner is the point of the collapse.
  Nothing was removed: all nine previously-listed permission types remain on the barrel.
- **`agent-cli` (patch)** — migrated as the only in-repo implementer of `ISubagentWorktreeAdapter`; no
  barrel change.

**`permissionPolicy` is now required at the spawn boundary**, and its default is one exported constant
owned by the permission SSOT. It was previously applied as `?? 'inherit-allowlist'` in the middle of a
projection, in **two** packages independently, with nothing keeping them equal — a security-relevant value
whose default was declared twice. Every spawn site now states its own policy.

**The worktree identity moved to the runner envelope.** It is runner-produced — the worktree does not
exist when a caller builds a request — so it rides on `ISubagentJobStart.worktree` and crosses the IPC
boundary there. The runner no longer also rewrites `request.cwd`, which had given ARCH-010's execution-root
rule two carriers that could disagree. `branchName` **relocated rather than being deleted**: it has no
reader in this repository today, and for a library that is not a reason to drop a legitimate contract.

**Renames are consistent across the SPI** (`type` → `agentType`, `jobId` → `taskId`) rather than applied to
one shape, which would have left two names for one identifier in a single file. The IPC validator's
string-literal keys are now typed against the contract, so the next rename is a compile error instead of a
runtime rejection of every start payload.
