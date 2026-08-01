---
title: 'PM-001: Onboarding Wizard — API key branch at first run'
status: done
completed: 2026-05-23
created: 2026-05-23
priority: critical
urgency: now
area: packages/agent-command
depends_on: [UX-012]
---

## Background

New users hit an API key requirement on first run with no guidance. 90% of users who don't reach
an AHA moment in the first 5 minutes abandon the tool.

## Changes Made

- Added `packages/agent-command/src/provider/provider-onboarding.ts`:
  - `runOnboardingBranch()` — prompts "Do you have an API key?" with 3 choices
  - Choice 1 (has key): proceeds to standard provider selection
  - Choice 2 (no key, cloud): shows Gemini free API key guide + link, then auto-selects Gemini
  - Choice 3 (no key, local): shows LM Studio setup guide + link, then auto-selects Gemma/local
- Updated `runProviderStartupSetup()` in `provider-startup.ts` to call `runOnboardingBranch()`
  at the start; skips provider selection when a type is preselected by the onboarding branch

## Test Plan

- 151/151 agent-command tests passing
- Typecheck clean

## User Execution Test Scenarios

Not applicable — first-run UX change verified via code review.
