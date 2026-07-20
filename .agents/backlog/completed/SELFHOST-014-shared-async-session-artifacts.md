---
title: 'SELFHOST-014: shared / synced async session artifacts for collaboration'
status: done
completed: 2026-07-19
created: 2026-07-16
priority: low
urgency: later
area: packages/agent-session, apps/agent-app, apps/agent-web
depends_on: []
---

# Shared / synced async session artifacts

Part of [SELFHOST-000](SELFHOST-000-self-hosting-capability-roadmap.md) / [VISION.md](../../VISION.md).
Differentiator. Robota has REMOTE-001 live P2P collaboration; the gap is **asynchronous** shareable/resumable
session artifacts (share a thread, resume it elsewhere/later) rather than only a live session.

## What

Persist a session as a **shareable artifact** in `agent-session` (export/import/resume a thread), surfaced for
sharing in `apps/agent-app`/`apps/agent-web`. Complements REMOTE-001's live channel with an async, durable form.

## Prior Art

Amp persistent Threads synced to cloud, resume across devices/teammates (https://ampcode.com/manual); GitHub
Copilot cloud agent draft PR + session logs (https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent);
Devin PR descriptions + shared Wiki (https://www.deployhq.com/guides/devin).

## Test Plan

Unit tests for session export/import round-trip + resume; a functional test that a shared artifact resumes on a
second surface. Architecture Review confirms persistence lives in agent-session, sharing UI in the app surfaces.
