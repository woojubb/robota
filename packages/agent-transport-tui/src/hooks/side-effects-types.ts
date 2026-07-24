import type { InteractiveSession } from '@robota-sdk/agent-framework';
import type { IStatusLineCommandSettings as TStatusLineSettings } from '@robota-sdk/agent-interface-transport';

export type { TStatusLineSettings };

/**
 * CMD-004 Phase 2 Stage C: the TUI is a pure renderer. This hook only manages the four UI screens
 * (driven by the requester-routed `ui_intent` session event), reflects the broadcast
 * `session_renamed` title, and refreshes the statusline display after a command result — it
 * executes no command semantics (the session layer applies host actions before the result returns).
 */
export interface IUseSideEffectsOptions {
  interactiveSession: InteractiveSession;
  baseHandleSubmit: (input: string) => Promise<void>;
  /** Reflect the host-executed rename (broadcast `session_renamed`) into the rendered title. */
  setSessionName: (name: string) => void;
  /** Re-read the persisted statusline settings (the HOST applied any patch) — refresh-on-result. */
  refreshStatusLineSettings: () => void;
  showSessionPickerOnStart?: boolean;
  openAgentSwitcher?: () => void;
}

export interface IUseSideEffectsResult {
  handleSubmit: (input: string) => Promise<void>;
  showPluginTUI: boolean;
  showSessionPicker: boolean;
  showTransportTUI: boolean;
  setShowPluginTUI: (show: boolean) => void;
  setShowSessionPicker: (show: boolean) => void;
  setShowTransportTUI: (show: boolean) => void;
}
