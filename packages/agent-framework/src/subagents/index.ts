export { createInProcessSubagentRunner } from './in-process-subagent-runner.js';
export type {
  IInProcessSubagentRunnerDeps,
  TSubagentRunnerFactory,
} from './in-process-subagent-runner.js';

/**
 * Consumers import the subagent SPI from `@robota-sdk/agent-executor` and the data contracts from
 * `@robota-sdk/agent-interface/execution`. This barrel re-publishes neither, so one field family
 * never has two owners.
 */
