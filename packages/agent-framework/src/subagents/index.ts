export { createInProcessSubagentRunner } from './in-process-subagent-runner.js';
export type {
  IInProcessSubagentRunnerDeps,
  TSubagentRunnerFactory,
} from './in-process-subagent-runner.js';

/**
 * ARCH-031: this file used to re-export eleven `agent-executor`-owned types. They were TYPES ONLY —
 * zero runtime values — so they bought none of the assembly convenience the then-current runtime-facade exception
 * exists for, while making one field family look like it had three owners. Consumers import from the
 * owner: the SPI from `@robota-sdk/agent-executor`, the data contracts from
 * `@robota-sdk/agent-interface-transport`.
 */
