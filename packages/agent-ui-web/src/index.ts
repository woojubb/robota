// @robota-sdk/agent-ui-web — the GUI presentation layer for a agent session.
// React components + a wire-protocol session reducer + a desktop shell, rendered over the transport-neutral
// TServerMessage stream. The GUI analog of agent-ui-terminal; consumed by apps/agent-app (desktop) and the
// browser surface (agent-transport-webrtc-web).

// ── Session reducer (transport-neutral) ─────────────────────
export { useSessionClient, useWsSession } from './hooks/useSessionClient.js';
export type {
  IConversationMessage,
  ICommandOutputEntry,
  IToolGroupEntry,
  TConversationEntry,
  IActiveTool,
  ISessionNotice,
  IWsSessionState,
  ISessionClientHandle,
  TMakeSessionClient,
} from './hooks/useSessionClient.js';
export type { TSessionListing, TSessionsError } from './hooks/session-client-types.js';
// Issue #3280 §5: a host that can restart the runtime calls this before reloading the page, so the
// first session listing after reconnecting can switch back to the session the person was in.
export { rememberSessionForRestore } from './hooks/use-session-directory.js';

// ── WS session client (loopback / localhost) ────────────────
export { createWsSessionClient } from './client/ws-session-client.js';
export type { IWsSessionClientCallbacks, TConnectionStatus } from './client/ws-session-client.js';
export { resolveClientRuntimeHost } from './client/runtime-host.js';
export type {
  IClientRuntimeBridge,
  IClientRuntimeEnvironment,
  IClientRuntimeHost,
  IClientTrustQuestion,
  TClientRuntimeState,
  TClientTrustChoice,
} from './client/runtime-host.js';

// ── Prompt (permission/ask) state ───────────────────────────
export { applyPromptEvent, permissionResponse, askResponse } from './hooks/prompt-state.js';
export type { TPendingPrompt } from './hooks/prompt-state.js';

// ── UI-intent (command screen-request) state — CMD-004 Stage D ──
export { describeUiIntentForGui, guiScreenForUiIntent } from './hooks/ui-intent-state.js';

// ── Presentation components ─────────────────────────────────
export { ConversationView } from './components/ConversationView.js';
export { AgentActivityPanel } from './components/AgentActivityPanel.js';
export { AgentSwitcherSheet } from './components/AgentSwitcherSheet.js';
export { PermissionPrompt } from './components/PermissionPrompt.js';
export { PersonalUsageDashboard } from './components/PersonalUsageDashboard.js';
export type { TPersonalUsageDashboardState } from './components/personal-usage-dashboard-types.js';
export { SessionSurface, CenteredChrome } from './components/SessionSurface.js';
export type { IComposerHandle, IPickedFile } from './components/Composer.js';
export { SessionSidebar } from './components/SessionSidebar.js';
export { SessionMonitor } from './components/SessionMonitor.js';
// #3282 §4a: the shared modal-shell primitive (also consumed by #3282 §2's mode-change confirmation
// and #3289 §1's session-delete confirmation) and the Settings screen it backs.
export { Dialog, ConfirmDialog } from './components/Dialog.js';
export type { IDialogProps, IConfirmDialogProps } from './components/Dialog.js';
export { SettingsScreen } from './components/SettingsScreen.js';
// #3282 §4e: the Help sheet `/help` opens instead of the terminal-style text list.
export { HelpSheet } from './components/HelpSheet.js';
// Pieces of a surface's chrome, not roots: render them inside a `agent-ui` scope.
export { ProductMark, ProductWordmark } from './components/Brand.js';

export { ProductIdentityProvider, useProductIdentity } from './product-identity.js';
export type { IWebProductIdentity } from './product-identity.js';
