/** UI-layer permission types for the Ink TUI */

import type { TToolArgs } from '@robota-sdk/agent-core';

/**
 * Permission result: true (allow once), false (deny), 'allow-session' (remember for session),
 * or 'allow-project' (persist to .robota/settings.local.json).
 */
export type TPermissionResult = boolean | 'allow-session' | 'allow-project';

export interface IPendingPermissionRequest {
  toolName: string;
  toolArgs: TToolArgs;
  resolve: (result: TPermissionResult) => void;
}
