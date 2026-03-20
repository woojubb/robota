/** UI-layer message types for the Ink TUI */

import type { TToolArgs } from '@robota-sdk/agent-core';

export interface IChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
  toolName?: string;
  /** Whether user approved or denied (for permission messages) */
  permissionResult?: 'allow' | 'deny';
}

/**
 * Permission result: true (allow once), false (deny), or 'allow-session' (remember for session).
 */
export type TPermissionResult = boolean | 'allow-session';

export interface IPermissionRequest {
  toolName: string;
  toolArgs: TToolArgs;
  resolve: (result: TPermissionResult) => void;
}
