/**
 * @robota-sdk/agent-process — domain-free child-process termination primitives.
 *
 * See docs/SPEC.md § Termination contract.
 */
export { DEFAULT_KILL_GRACE_MS, killProcessTree } from './kill-process.js';
export type { IKillProcessOptions } from './kill-process.js';
