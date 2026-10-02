# Web App Specification

## Purpose

Owns the browser remote application: a Next.js host that serves the client for the configured CLI's remote
control, a second screen for a running session.

## Contract

- Does not own package-level runtime contracts; renders only the browser-safe
  `@robota-sdk/agent-transport-webrtc-web/client` entry and never imports provider packages — keeping
  server-only code out of the browser bundle.
- Hosts no API server and holds no secrets: the remote client takes everything it needs from its URL
  and connects out to the signaling relay.

## Non-goals

- No package-level runtime or auth logic beyond deployment/frontend integration.
