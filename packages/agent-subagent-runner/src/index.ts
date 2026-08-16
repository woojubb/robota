export {
  ChildProcessSubagentRunner,
  createChildProcessSubagentRunnerFactory,
} from './child-process-subagent-runner.js';
export type { IChildProcessSubagentRunnerOptions } from './child-process-subagent-runner.js';

export {
  isSubagentWorkerChildMessage,
  isSubagentWorkerParentMessage,
} from './child-process-subagent-ipc.js';
export type {
  ISubagentWorkerStartPayload,
  TSubagentWorkerChildMessage,
  TSubagentWorkerParentMessage,
  TSubagentWorkerWireValue,
} from './child-process-subagent-ipc.js';

// DIST-006: `getDefaultSubagentWorkerPath` is gone, not renamed. It answered "where is my worker
// file on disk?" from a library that cannot know — the answer is a property of the packaging step —
// and it was wrong twice. The composition root now states how to start a copy of itself.
export {
  SUBAGENT_WORKER_MODE_FLAG,
  isSubagentWorkerModeArgv,
  type ISubagentWorkerEntry,
} from './worker-entry.js';
export { runSubagentWorkerMain } from './child-process-subagent-worker.js';
export type { ISubagentWorkerComposition } from './worker-composition.js';
