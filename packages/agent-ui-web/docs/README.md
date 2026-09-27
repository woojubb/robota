# @robota-sdk/agent-ui-web

The **GUI presentation layer** for a robota session — the graphical analog of `@robota-sdk/agent-ui-terminal`.
It reconstructs conversation state from the transport-neutral `TServerMessage` stream and renders it as React
components, and it ships the desktop **session shell** (title/status bar, conversation column, background
activity rail, composer, permission modal). It is an internal workspace package (`private: true`), consumed
by the GUI web app (`@robota-sdk/agent-gui-web`, which the desktop app loads and `robota --serve` serves)
and by the browser-remote surface (`@robota-sdk/agent-transport-webrtc-web`).

## What it owns

- `useSessionClient(makeClient)` — the transport-neutral session reducer (generic over the status type).
- `useWsSession(url)` + `createWsSessionClient` — the localhost WebSocket binding.
- Prompt state: `applyPromptEvent`, `permissionResponse`, `askResponse`.
- UI-intent state: `guiScreenForUiIntent` (the GUI screen a command's UI intent opens, if any) and
  `describeUiIntentForGui` (the explicit "not available on this surface" line otherwise).
- Components: `SessionSurface`, `CenteredChrome`, `ConversationView`, `AgentActivityPanel`,
  `PermissionPrompt`, `SessionSidebar` (the host's sessions; switch or start one), `SessionMonitor` (a
  self-contained session page for a WebSocket URL), and `PersonalUsageDashboard` (7- and 30-day usage).
- Brand marks: `RobotaMark`, `RobotaWordmark` — render them inside a `robota-ui` scope.
- `styles/surface.css` — the design scoped to `.robota-ui` (bundled Pretendard, light and dark tokens, Tailwind
  token map, base layers); import it into a host app's Tailwind entry to embed the surface.
- `styles/theme.css` — `surface.css` plus what a page that is only the surface owns (height, background,
  scrollbars); that page puts `robota-ui` on its `<html>`.

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
