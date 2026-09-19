import type { ITuiSessionUiEventPort } from '../tui-app-channel-port.js';
import type { IStatusLineCommandSettings as TStatusLineSettings } from '@robota-sdk/agent-interface-command';

export type { TStatusLineSettings };

/**
 * CMD-004 Phase 2 Stage C: the TUI is a pure renderer. This hook only manages the UI screens
 * (driven by the requester-routed `ui_intent` session event), reflects the broadcast
 * `session_renamed` title, and refreshes the statusline display after a command result — it
 * executes no command semantics (the session layer applies host actions before the result returns).
 */
export interface IUseSideEffectsOptions {
  uiEventPort: ITuiSessionUiEventPort;
  baseHandleSubmit: (input: string) => Promise<void>;
  /** Reflect the host-executed rename (broadcast `session_renamed`) into the rendered title. */
  setSessionName: (name: string) => void;
  /** Re-read the persisted statusline settings (the HOST applied any patch) — refresh-on-result. */
  refreshStatusLineSettings: () => void;
  /**
   * SCREEN-2002: re-read the persisted appearance the same way. A `/theme` result has already been
   * applied to the settings document by the host, so the live theme changes when this fires — which
   * is what makes a theme switch take effect without a restart.
   */
  refreshAppearanceSettings: () => void;
  showSessionPickerOnStart?: boolean;
  openAgentSwitcher?: () => void;
  /**
   * CLI-1994: honour a `switch-session` UI intent — point this terminal at another persisted
   * session (a fork being attached to). The surface's existing session-switch path: a new channel
   * from the factory with the previous one stopped first. A view switch, never a merge.
   */
}

export interface IUseSideEffectsResult {
  handleSubmit: (input: string) => Promise<void>;
  showPluginTUI: boolean;
  showSessionPicker: boolean;
  showTransportTUI: boolean;
  /** SCREEN-2002: the theme picker, opened by the `show-theme-picker` intent. */
  showThemePicker: boolean;
  setShowPluginTUI: (show: boolean) => void;
  setShowSessionPicker: (show: boolean) => void;
  setShowTransportTUI: (show: boolean) => void;
  setShowThemePicker: (show: boolean) => void;
}
