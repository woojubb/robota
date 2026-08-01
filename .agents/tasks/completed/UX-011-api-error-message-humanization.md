---
title: 'UX-011: API error message humanization'
status: done
completed: 2026-05-23
created: 2026-05-23
priority: critical
urgency: now
area: packages/agent-framework
depends_on: []
---

## Background

API errors surfaced raw technical strings like `Error: 401 Unauthorized — invalid x-api-key`,
leaving users without actionable resolution guidance.

## Changes Made

- Added `packages/agent-framework/src/utils/error-humanizer.ts` — maps typed error classes
  (`AuthenticationError`, `RateLimitError`, `NetworkError`, `ProviderError`) and common HTTP
  status code patterns (401, 403, 429, 500, 502, 503, timeout, network) to user-friendly messages
  with resolution hints (e.g. "Run `/provider` to reconfigure")
- Applied `humanizeApiError()` in `interactive-session-prompt.ts` (main prompt turn error path)
- Applied `humanizeApiError()` in `interactive-session-execution-controller.ts` (fork-skill error path)
- Updated `interactive-session-behavior.test.ts` to match humanized message text

## Test Plan

- 828/828 tests passing
- Humanized message verified by existing test: rate-limit error produces "Rate limit reached..." system message

## User Execution Test Scenarios

Not applicable — no new user-visible command; error messages appear automatically on API failures.
