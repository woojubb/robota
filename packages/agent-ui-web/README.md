# @robota-sdk/agent-ui-web

Browser-safe React components and session state for a consumer-owned agent renderer. The public
`/client` entry provides a WebSocket client, session surface, permission and command presentation,
restore support, and a narrow desktop runtime-host contract.

```tsx
import {
  ProductIdentityProvider,
  SessionSurface,
  useWsSession,
} from '@robota-sdk/agent-ui-web/client';

const product = {
  identity: { displayName: 'Cedar Agent', cliName: 'cedar' },
  storage: { browserNamespace: 'cedar.agent' },
} as const;

function AgentView({ url }: { url: string }) {
  const session = useWsSession(url);
  return <SessionSurface state={session} surface="app" />;
}

export function App({ url }: { url: string }) {
  return (
    <ProductIdentityProvider value={product}>
      <AgentView url={url} />
    </ProductIdentityProvider>
  );
}
```

Every component reads the product's display name and browser namespace from `ProductIdentityProvider`
and throws without one.

Import `@robota-sdk/agent-ui-web/styles/theme.css` into a page's Tailwind v4 CSS entry, or import
`styles/surface.css` when embedding the surface inside another page. These are bundler CSS assets,
not Node modules. The consumer supplies React, React DOM, Tailwind v4, and its own runtime host.

See the [package guide](docs/README.md) for the component and styling contract.
