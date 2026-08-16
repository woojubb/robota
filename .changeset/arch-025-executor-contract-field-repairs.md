---
'@robota-sdk/agent-executor': minor
'@robota-sdk/agent-framework': patch
---

**ARCH-025: `SubagentManager.wait()` carries `usage`, and `IScheduleEditPatch` becomes nameable.**

Two declared contract fields were unreachable by the projections meant to carry them.

`wait()` returned `{ jobId, output, metadata }` and dropped `usage`, though `ISubagentJobResult.usage` is
declared (ANALYTICS-001) and populated end to end. The field was born dropped: the commit that added
`usage` to `toBackgroundResult` never touched `wait()` two hundred lines above. It now uses the same
conditional spread, so the two directions of the hop read identically.

This is a **contract repair, not a user-visible one** — worth stating because an earlier draft of this work
claimed otherwise. `/cost` is fed by the `background_task_completed` event path and already worked;
`wait()` feeds `IOrchestrationStepResult.usage`, which nothing currently reads. Forward-provisioned
surfaces carry the same quality bar, which is why it is fixed rather than deferred.

`IScheduleEditPatch` is the parameter type of the public `IBackgroundTaskManager.editScheduledTask` and
`IBackgroundTaskHandle.editSchedule`, but it was on neither barrel, so a consumer of those methods could
not name its own parameter type. It is now exported (**new export → minor**), and both structural
re-declarations in `agent-framework` are gone — `IAgentJobHostContext.editSchedule`, the interface every
command module programs against, and the class method implementing it.

```ts
// before — the caller could not name the type it had to pass
editSchedule(
  taskId: string,
  patch: { cronExpression?: string; agentInstruction?: string; command?: string },
): Promise<void>;

// after
import type { IScheduleEditPatch } from '@robota-sdk/agent-executor';
editSchedule(taskId: string, patch: IScheduleEditPatch): Promise<void>;
```

Not a surface change for `agent-framework`: TypeScript is structural, so every existing implementer and
caller satisfies the named type unchanged.

**Deliberately not in this change.** `providerProfile` is a dead contract field whose disposition belongs
with the seam, and the seam itself — one field family declared three times and carried by hand-written
literals nothing checks for totality — is filed as **ARCH-031** (issue #1747) after a `FOUNDATIONAL`
finding-depth verdict. ARCH-031's derivation will subsume the `wait()` repair rather than undo it.
