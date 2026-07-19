// `@robota-sdk/dag-adapters-local/testing` — test-support ports for the DAG adapters.
//
// HARNESS-033: these are consumed almost entirely by dag-* tests. They live behind this dedicated `./testing`
// entry (mirroring `@robota-sdk/agent-core/testing`) rather than the package main export, and are named for what
// they ARE (manual clock / scripted executor / canned backend) so no `Fake*`/`Mock*`/`Stub*` test-double name
// ships in the package's production surface (the no-fake-in-src floor, HARNESS-032).
export { ManualClockPort } from './manual-clock-port.js';
export { ScriptedTaskExecutorPort } from './scripted-task-executor-port.js';
export type { TTaskExecutorHandler } from './scripted-task-executor-port.js';
export { createCannedPromptBackend } from './canned-prompt-backend.js';
