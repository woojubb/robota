/** UI-layer message types for the Ink TUI */

import type { TToolArgs } from '../permissions/permission-gate.js';

export interface IChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
  toolName?: string;
  /** Whether user approved or denied (for permission messages) */
  permissionResult?: 'allow' | 'deny';
}

export interface IPermissionRequest {
  toolName: string;
  toolArgs: TToolArgs;
  resolve: (allowed: boolean) => void;
}
