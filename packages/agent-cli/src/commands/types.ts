// Re-export from SDK — command types are now owned by agent-sdk
export type { ICommand, ICommandSource } from '@robota-sdk/agent-sdk';

// CLI alias — slash prefix behavior is owned by the CLI layer
export type { ICommand as ISlashCommand } from '@robota-sdk/agent-sdk';
