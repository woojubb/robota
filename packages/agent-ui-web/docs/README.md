# @robota-sdk/agent-ui-web

The **GUI presentation layer** for a robota session — the graphical analog of `@robota-sdk/agent-ui-terminal`.
It reconstructs conversation state from the transport-neutral `TServerMessage` stream and renders it as React
components, and it ships the desktop **session shell** (title/status bar, conversation column, background
activity rail, composer, permission modal). Consumed by the desktop app (`apps/agent-app`) and the
browser-remote surface (`@robota-sdk/agent-transport-webrtc-web`).

## What it owns

- `useSessionClient(makeClient)` — the transport-neutral session reducer (generic over the status type).
- `useWsSession(url)` + `createWsSessionClient` — the localhost WebSocket binding.
- Prompt state: `applyPromptEvent`, `permissionResponse`, `askResponse`.
- Components: `ConversationView`, `AgentActivityPanel`, `PermissionPrompt`, `SessionSurface`, `CenteredChrome`.
- `styles/theme.css` — the "terminal-noir" theme (design tokens + Tailwind token map + base layers).

## Using it

```tsx
import { useWsSession, SessionSurface } from '@robota-sdk/agent-ui-web/client';

export function App({ url }: { url: string }) {
  const state = useWsSession(url);
  return <SessionSurface state={state} surface="app" />;
}
```

The components author Tailwind utility classes and ship **no compiled CSS** — the consumer owns the Tailwind
entry and sources this package's `src`:

```css
/* app entry css */
@import 'tailwindcss';
@import '@robota-sdk/agent-ui-web/styles/theme.css';
@source '../../node_modules/@robota-sdk/agent-ui-web/src';
@source './';
```

A different transport supplies its own `makeClient` (a `TMakeSessionClient<TStatus>`) and, if it adds
connection states, instantiates `useSessionClient<ItsStatus>` — see `useRtcSession` in `@robota-sdk/agent-transport-webrtc-web`.

See [SPEC.md](./SPEC.md) for the full contract.
