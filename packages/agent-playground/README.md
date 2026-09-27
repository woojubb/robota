# @robota-sdk/agent-playground

The Robota Playground UI: a React app for experimenting with agents in the browser — configure an agent,
add tools and skills, chat with it, and export the configuration as code. Agents run on a remote agent
server (`apps/agent-server`), reached through `@robota-sdk/agent-remote-client`; the playground runs no
session stack of its own.

This is an internal workspace package (`private: true`), not published to npm. The Next.js app in
`apps/agent-web` hosts it at `/playground`, plus a demo at `/playground/demo` that renders built-in
sample execution data without calling any provider. Authentication, signup/login, credits, billing, and
pricing are intentionally not part of it.

## Usage

Browser pages import from the `/client` entry, which exports only the React components:

```tsx
'use client';

import { PlaygroundApp } from '@robota-sdk/agent-playground/client';

export default function PlaygroundPage() {
  return <PlaygroundApp defaultServerUrl="ws://localhost:3001" />;
}
```

`defaultServerUrl` is the agent server's WebSocket URL (`ws://localhost:3001` when omitted);
`apps/agent-web` passes `NEXT_PUBLIC_PLAYGROUND_WS_URL`. `PlaygroundDemo` takes no props. The root
entry also exports the service layer (executor, WebSocket client and message types, block tracking)
for non-page consumers — `apps/agent-server` takes the playground WebSocket message types from it — and
is not meant as a browser page entry.

The components use Tailwind classes; the host's CSS entry must source this package's `src` (see
`apps/agent-web/src/app/globals.css`).

See [docs/SPEC.md](./docs/SPEC.md) for the package scope and dependency boundary.
