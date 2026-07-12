// @robota-sdk/agent-transport-gui — the GUI presentation layer for a robota session.
// React components + a wire-protocol session reducer + a desktop shell, rendered over the transport-neutral
// TServerMessage stream. The GUI analog of agent-transport-tui; consumed by apps/agent-app (desktop) and the
// browser surface (agent-transport-webrtc-web).

// ── Session reducer (transport-neutral) ─────────────────────
export { useSessionClient, useWsSession } from './hooks/useSessionClient.js';
export type {
  IConversationMessage,
  IActiveTool,
  IWsSessionState,
  ISessionClientHandle,
  TMakeSessionClient,
} from './hooks/useSessionClient.js';

// ── WS session client (loopback / localhost) ────────────────
export { createWsSessionClient } from './client/ws-session-client.js';
export type { TConnectionStatus } from './client/ws-session-client.js';

// ── Prompt (permission/ask) state ───────────────────────────
export { applyPromptEvent, permissionResponse, askResponse } from './hooks/prompt-state.js';
export type { TPendingPrompt } from './hooks/prompt-state.js';

// ── Presentation components ─────────────────────────────────
export { ConversationView } from './components/ConversationView.js';
export { AgentActivityPanel } from './components/AgentActivityPanel.js';
export { PermissionPrompt } from './components/PermissionPrompt.js';
export { SessionSurface, CenteredChrome } from './components/SessionSurface.js';
export { SessionMonitor } from './components/SessionMonitor.js';
