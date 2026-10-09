# @robota-sdk/agent-ui-web

The **GUI presentation layer** for an agent session — the graphical analog of `@robota-sdk/agent-ui-terminal`.
It reconstructs conversation state from the transport-neutral `TServerMessage` stream and renders it as React
components. Its public `/client` entry supplies the browser-safe reducer, WebSocket client, session shell
and runtime-host contract for a consumer-owned renderer. The same components serve the repository's GUI
web app and browser-remote surface.

## What it owns

- `useSessionClient(makeClient)` — the transport-neutral session reducer (generic over the status type).
- `useWsSession(url)` + `createWsSessionClient` — the localhost WebSocket binding.
- `resolveClientRuntimeHost(environment)` — a browser endpoint resolver or a narrow desktop bridge
  adapter. The desktop bridge owns trust, endpoint validation and runtime lifecycle; a renderer asks
  `trustQuestion` before `getEndpoint` and calls `signalReady` after connection.
- Prompt state: `applyPromptEvent`, `permissionResponse`, `askResponse`.
- UI-intent state: `guiScreenForUiIntent` (the GUI screen a command's UI intent opens, if any) and
  `describeUiIntentForGui` (the explicit "not available on this surface" line otherwise).
- Components: `SessionSurface`, `CenteredChrome`, `ConversationView`, `AgentActivityPanel`,
  `PermissionPrompt`, `SessionSidebar` (the host's sessions; switch or start one), `SessionMonitor` (a
  self-contained session page for a WebSocket URL), and `PersonalUsageDashboard` (7- and 30-day usage).
- Brand marks: `ProductMark`, `ProductWordmark` — render them inside a `agent-ui` scope.
- `styles/surface.css` — the design scoped to `.agent-ui` (bundled Pretendard, light and dark tokens, Tailwind
  token map, base layers); import it into a host app's Tailwind entry to embed the surface.
- `styles/theme.css` — `surface.css` plus what a page that is only the surface owns (height, background,
  scrollbars); that page puts `agent-ui` on its `<html>`.

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

The source repository's Cedar renderer fixture shows a consumer-owned toolbar calling a custom
command, desktop trust admission, session restoration and reconnect. Its local-pack
build is prerelease evidence; a clean registry-installed build is required after publication.

The package tarball includes source styles, declarations and its AGPL license. React is a peer dependency;
the consumer supplies React, React DOM, Tailwind v4 and a bundler. Third-party runtime dependencies are
declared in `package.json`; a distributable renderer must include their notices and licenses in its own
artifact. The package does not include the private GUI web app or Electron shell.
