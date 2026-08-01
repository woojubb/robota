---
title: 'SELFHOST-013: multi-surface deployment + gateway (one agent → many channels/runtimes)'
status: done
completed: 2026-07-19
created: 2026-07-16
priority: low
urgency: later
area: packages/agent-transport, apps/agent-server, docs
depends_on: []
---

# Multi-surface deployment + gateway

Part of [SELFHOST-000](SELFHOST-000-self-hosting-capability-roadmap.md) / [VISION.md](../../VISION.md).
Differentiator. Robota already has cli/desktop/web/remote surfaces over a transport DIP; the gap is a documented,
first-class **"one agent definition → many channels/runtimes"** deployment story.

## What

Largely a packaging + documentation effort over the existing transport DIP: a documented pattern (and any thin
glue) for deploying one agent definition to multiple channels/runtimes (CLI, desktop, web, HTTP/WS server,
remote), plus the deployment matrix. No new coupling; formalize what the transports already enable.

## Prior Art

Hermes 20+ chat-platform gateway + 6 terminal/deploy backends (Docker/SSH/Daytona/Modal, …,
https://hermes-agent.nousresearch.com/docs/); Google ADK deployment-agnostic (Vertex/Agent Engine,
https://google.github.io/adk-docs/).

## Test Plan

Doc/example coverage of the deploy matrix; a functional test that one agent definition serves over ≥2 transports
unchanged. Architecture Review confirms this rides the transport DIP with no new sibling coupling.
