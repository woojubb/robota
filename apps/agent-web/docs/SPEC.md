# Web App Specification

## Scope

Owns the Robota web application. A Next.js 15 host that serves the Playground UI
(`@robota-sdk/agent-playground/client`) and provides the browser runtime composition layer. The root
route redirects to `/playground`.

## Boundaries

- Does not own package-level runtime contracts; imports browser-safe components from
  `@robota-sdk/agent-playground/client` and shared contracts/components from
  `@robota-sdk/agent-core`.
- Does not own API server behavior; that belongs to `apps/agent-server`.
- The browser host must not import provider packages, `apps/agent-server`, or the root
  `@robota-sdk/agent-playground` entry; it renders the browser-safe
  `@robota-sdk/agent-playground/client` entry only.
- Keeps deployment, auth configuration, and frontend integration behavior within this app.
- Styling uses Tailwind CSS v4 utility classes only.

## Architecture Overview

Next.js App Router application with the following route structure:

- `/` -- redirects to `/playground`.
- `/playground` -- Playground main page.
- `/playground/demo` -- Playground demo mode.
- `/monitor` -- CLI second-screen browser monitor. Connects to a running CLI session via WebSocket
  (default `NEXT_PUBLIC_CLI_WS_URL`, fallback `ws://localhost:7070`) and renders live conversation
  output. Implemented by `MonitorClient` (`src/app/monitor/MonitorClient.tsx`), which uses
  `SessionMonitor` from `@robota-sdk/agent-web-ui/client` (the published browser component library).

The app composes workspace packages as React components. Client-side caching is provided by
`src/lib/cache.ts`. Browser builds explicitly disable Node builtin polyfills in `next.config.ts` so
Node-only optional exports from workspace packages do not enter the client bundle.

Playground page (`src/app/playground/page.tsx`) dynamically imports `PlaygroundApp` from
`@robota-sdk/agent-playground/client` with SSR disabled. The default WebSocket URL is supplied via
`NEXT_PUBLIC_PLAYGROUND_WS_URL`.

## Type Ownership

This app is SSOT for:

- `TTheme` -- theme type (`'light' | 'dark' | 'system'`). `src/types/index.ts`
- `INavItem`, `INavSection` -- navigation structure types. `src/types/index.ts`
- `IBrandConfig` -- brand configuration type. `src/types/index.ts`
- `ILayoutProps` -- layout component props. `src/types/index.ts`
- `IApiResponse<T>` -- generic API response wrapper. `src/types/index.ts`

## Public API Surface

This is a private app (`"private": true`); it has no published API surface. Internal exports:

| Export          | Kind             | Location                            | Description                                |
| --------------- | ---------------- | ----------------------------------- | ------------------------------------------ |
| `SimpleCache`   | class            | `src/lib/cache.ts`                  | Generic in-memory TTL cache                |
| `cache`         | instance         | `src/lib/cache.ts`                  | Default cache instance                     |
| `randomUUID`    | function         | `src/lib/crypto-browser.ts`         | Browser-safe `crypto.randomUUID()` wrapper |
| `MonitorClient` | React component  | `src/app/monitor/MonitorClient.tsx` | CLI second-screen monitor (client-only)    |
| Page components | React components | `src/app/`                          | Next.js route pages                        |

## Extension Points

- `NEXT_PUBLIC_PLAYGROUND_WS_URL` -- overrides the default WebSocket URL passed to `PlaygroundApp`.
- `NEXT_PUBLIC_CLI_WS_URL` -- overrides the CLI monitor WebSocket URL passed to `SessionMonitor` (default `ws://localhost:7070`).
- Layout composition -- `src/app/layout.tsx` provides the root layout shell (fonts, metadata).

## Error Taxonomy

No package-specific error types defined. Errors are handled by:

- Next.js built-in error boundaries.
- `IApiResponse.error` field for API call failures.

## Class Contract Registry

### Interface Implementations

None. No classes implement external interfaces.

### Inheritance Chains

None.

### Classes

| Class                 | Kind                 | Location           | Notes                                      |
| --------------------- | -------------------- | ------------------ | ------------------------------------------ |
| `SimpleCache<TValue>` | standalone (generic) | `src/lib/cache.ts` | In-memory TTL cache, no external contracts |

### Cross-Package Port Consumers

| Port (Owner)                                            | Consumer        | Location                            |
| ------------------------------------------------------- | --------------- | ----------------------------------- |
| `PlaygroundApp` (`@robota-sdk/agent-playground/client`) | Playground page | `src/app/playground/page.tsx`       |
| `SessionMonitor` (`@robota-sdk/agent-web-ui/client`)    | MonitorClient   | `src/app/monitor/MonitorClient.tsx` |

## Test Strategy

- **Test framework**: Jest with `@testing-library/react` and `jest-environment-jsdom`.
- **Current state**: 1 test file exists.
  - `src/lib/cache.test.ts` — 8 unit tests for `SimpleCache` (get/set, TTL expiry, delete, clear, size, getOrSet dedup, cleanup).
- **Coverage gaps**: No component tests, no route tests, no API integration tests.
- Recommended: component tests for `MonitorClient` and Playground page integration.
