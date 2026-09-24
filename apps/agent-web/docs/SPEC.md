# Web App Specification

## Purpose

Owns the Robota web application: a Next.js host that serves the Playground UI and the browser runtime
composition layer for it, plus a CLI second-screen monitor.

## Contract

- Does not own package-level runtime contracts; renders only the browser-safe
  `@robota-sdk/agent-playground/client` entry, never the root `@robota-sdk/agent-playground` entry or
  provider packages, and never imports `apps/agent-server` — keeping server-only code out of the
  browser bundle.
- Does not own API server behavior; that belongs to `apps/agent-server`.

## Non-goals

- No package-level runtime or auth logic beyond deployment/frontend integration.
