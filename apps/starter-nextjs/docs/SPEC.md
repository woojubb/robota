# Starter Next.js App Specification

## Scope

`@robota-sdk/starter-nextjs` owns a minimal Next.js 15 starter template that demonstrates embedding the Robota SDK into a web application. It provides a single POST API route (`/api/chat`) that accepts a `message` string, invokes the Robota agent runtime, and returns the agent reply as JSON. It is the canonical reference showing how to wire `@robota-sdk/agent-framework` and `@robota-sdk/agent-provider` together inside a Next.js App Router API route.

## Boundaries

- Does not implement any agent runtime, session, or provider logic — all AI execution is delegated to `@robota-sdk/agent-framework` and `@robota-sdk/agent-provider`.
- Does not include a frontend chat UI (`app/page.tsx` is intentionally absent in the minimal template).
- Does not manage conversation history or session persistence across HTTP requests.
- Does not define custom authentication, rate limiting, or middleware.
- Does not export any library symbols for programmatic consumption by other packages.
- Database, auth, and multi-turn session persistence are explicitly out of scope and belong in consumer applications built on top of this template.

## Architecture Overview

```text
apps/starter-nextjs
  ├── app/
  │   └── api/
  │       └── chat/
  │           └── route.ts     -- Next.js App Router POST handler: /api/chat
  ├── next.config.ts            -- Minimal Next.js config (no customizations)
  ├── package.json              -- Dependencies: next, react, react-dom, agent-framework, agent-provider
  └── tsconfig.json             -- Next.js bundler module resolution, strict TS
```

Execution flow for `POST /api/chat`:

1. Validates `ANTHROPIC_API_KEY` environment variable; returns HTTP 500 if absent.
2. Parses request body; validates `message` is a non-empty string; returns HTTP 400 if invalid.
3. Constructs an `AnthropicProvider` with the API key.
4. Creates an agent runtime via `createAgentRuntime({ cwd, provider })`.
5. Creates a session with `permissionMode: 'bypassPermissions'`.
6. Submits the user message via `session.submit(userMessage)`.
7. Returns `{ reply: response }` as JSON.

Design rules:

- Stateless per-request: a new runtime and session are created on every request.
- No fallback paths — missing env var or invalid input returns an error response immediately.
- Template is intentionally minimal to serve as the simplest possible starting point.

## Type Ownership

This app defines no SSOT types. All types are imported from Next.js (`NextRequest`, `NextResponse`) and the Robota SDK packages.

| Type     | Location | Purpose                                                   |
| -------- | -------- | --------------------------------------------------------- |
| _(none)_ | —        | No app-owned types; all shapes come from SDK dependencies |

## Public API Surface

This app has no library exports. It exposes one HTTP endpoint consumed by web clients:

| Endpoint    | Method | Request Body                    | Response Body           | Description                              |
| ----------- | ------ | ------------------------------- | ----------------------- | ---------------------------------------- |
| `/api/chat` | POST   | `{ message: string }`           | `{ reply: string }`     | Submit a message and receive agent reply |
| `/api/chat` | POST   | missing/invalid `message`       | `{ error: string }` 400 | Validation error                         |
| `/api/chat` | POST   | missing `ANTHROPIC_API_KEY` env | `{ error: string }` 500 | Configuration error                      |

## Extension Points

Consumers extending this template are expected to modify source directly (it is a starter template, not a library). Documented extension paths from `README.md`:

| Extension                           | How                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| Add a frontend UI                   | Create `app/page.tsx` with a chat component                                         |
| Swap AI provider                    | Replace `AnthropicProvider` with another provider from `@robota-sdk/agent-provider` |
| Persist conversation history        | Pass a `sessionId` across requests and retrieve prior session state                 |
| Add authentication or rate limiting | Add Next.js middleware (`middleware.ts`) or wrap the route handler                  |

## Error Taxonomy

This app defines no custom error classes. Errors are handled inline in the route handler:

| Condition                         | HTTP Status | Response                                               |
| --------------------------------- | ----------- | ------------------------------------------------------ |
| `ANTHROPIC_API_KEY` not set       | 500         | `{ error: 'ANTHROPIC_API_KEY is not set' }`            |
| `message` missing or not a string | 400         | `{ error: 'message is required' }`                     |
| SDK / provider runtime error      | Unhandled   | Propagates as Next.js 500 (no explicit catch in route) |

## Test Strategy

**Test files**: None — this is a starter template with no automated test suite.

**Coverage gaps**:

- No unit tests for the route handler logic.
- No integration tests for the `/api/chat` endpoint.
- No environment validation tests.
- Manual testing via `curl` is described in `README.md` as the intended verification path.

Future test additions should use Vitest with Next.js route handler mocking or a test HTTP client against a running dev server.

## Class Contract Registry

This app defines no classes and implements no interfaces from external packages.

| Symbol         | Kind     | Implements / Extends | Notes                                        |
| -------------- | -------- | -------------------- | -------------------------------------------- |
| `POST` (route) | function | —                    | Next.js App Router named export; not a class |
