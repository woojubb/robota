# @robota-sdk/agent-ui-web

Browser-safe React components and session state for a consumer-owned agent renderer. The public
`/client` entry provides a WebSocket client, session surface, permission and command presentation,
restore support, and a narrow desktop runtime-host contract.

```tsx
import { SessionSurface, useWsSession } from '@robota-sdk/agent-ui-web/client';

export function AgentView({ url }: { url: string }) {
  const session = useWsSession(url);
  return <SessionSurface state={session} surface="app" />;
}
```

Import `@robota-sdk/agent-ui-web/styles/theme.css` into a page's Tailwind v4 CSS entry, or import
`styles/surface.css` when embedding the surface inside another page. These are bundler CSS assets,
not Node modules. The consumer supplies React, React DOM, Tailwind v4, and its own runtime host.

See the [package guide](docs/README.md) for the component and styling contract.
