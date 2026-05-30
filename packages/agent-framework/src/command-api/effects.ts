import type { TStatusLineCommandSettingsPatch } from './statusline/statusline-command-api.js';
import type { TSessionEndReason } from '@robota-sdk/agent-core';

export type TCommandEffect =
  | { type: 'provider-hot-swap-requested'; profileName: string }
  | { type: 'language-change-requested'; language: string }
  | { type: 'settings-reset-requested' }
  | { type: 'session-exit-requested'; reason?: TSessionEndReason; message?: string }
  | { type: 'session-restart-requested'; reason: TSessionEndReason; message: string }
  | { type: 'plugin-tui-requested' }
  | { type: 'plugin-registry-reload-requested' }
  | { type: 'settings-tui-requested' }
  | { type: 'session-picker-requested' }
  | { type: 'session-renamed'; name: string }
  | { type: 'conversation-history-cleared' }
  | { type: 'session-execution-started' }
  | { type: 'statusline-settings-patch'; patch: TStatusLineCommandSettingsPatch }
  | { type: 'agent-switcher-requested' };
