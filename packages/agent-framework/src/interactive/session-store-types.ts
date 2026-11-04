import type { IToolResultSpillStore } from '@robota-sdk/agent-core';
import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  IResumableSessionSummary,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface-session';

// Session persistence contracts SSOT relocated to @robota-sdk/agent-interface-session (DATA-001).
export type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  IResumableSessionSummary,
  TSessionLoadOutcome,
};

/** The spill store a host owns for bounded MCP result references, as `createNodeToolResultSpillStore` builds it. */
export interface IHostToolResultSpillStore extends IToolResultSpillStore {
  read(reference: string): Promise<string>;
  shutdown(): Promise<void>;
}
