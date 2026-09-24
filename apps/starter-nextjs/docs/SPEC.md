# Starter Next.js App Specification

## Purpose

`@robota-sdk/starter-nextjs` is a minimal Next.js starter template demonstrating how to embed the
Robota SDK into a web application: a single chat API route that invokes the Robota agent runtime and
returns its reply. It is the canonical reference for wiring `@robota-sdk/agent-framework` and
`@robota-sdk/agent-provider-anthropic` together inside a Next.js App Router API route.

## Contract

- Does not implement any agent runtime, session, or provider logic — all AI execution is delegated to
  `@robota-sdk/agent-framework` and `@robota-sdk/agent-provider-anthropic`.
- Does not manage conversation history or session persistence across requests; each request creates a
  fresh runtime and session.
- Does not define custom authentication, rate limiting, or middleware, and exports no library symbols
  for programmatic consumption.
- Safety caveat: the chat route is unauthenticated and runs the agent with
  `permissionMode: 'bypassPermissions'` over the server's working directory. It is a local demo;
  add authentication and a restrictive permission mode before exposing it.

## Non-goals

- No frontend chat UI, database, auth, or multi-turn session persistence — these are left to consumer
  applications built on top of this template.

## Design decisions

- The template is intentionally minimal, with no fallback paths, to serve as the simplest possible
  starting point for embedding the SDK.
