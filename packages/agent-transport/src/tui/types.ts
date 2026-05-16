/** UI-layer permission types for the Ink TUI */

import type { TToolArgs } from '@robota-sdk/agent-core';

/**
 * Permission result: true (allow once), false (deny), or 'allow-session' (remember for session).
 */
export type TPermissionResult = boolean | 'allow-session';

export interface IPermissionRequest {
  toolName: string;
  toolArgs: TToolArgs;
  resolve: (result: TPermissionResult) => void;
}
