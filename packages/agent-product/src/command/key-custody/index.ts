export {
  KeyCustodyCommandSource,
  createKeyCustodyCommandModule,
  executeLockCommand,
  executeUnlockCommand,
} from './key-custody-command-module.js';
export { registeredUnlockCommand } from './registered-unlock-command.js';
export type {
  IKeyCustodyCommandPort,
  IUnlockResult,
  TUnlockOutcome,
} from './key-custody-command-port.js';
