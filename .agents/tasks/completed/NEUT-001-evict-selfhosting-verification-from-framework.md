---
title: 'NEUT-001: evict Robota repo-process from agent-framework self-hosting-verification'
status: done
completed: 2026-07-25
created: 2026-07-25
priority: high
urgency: soon
area: packages/agent-framework
depends_on: []
---

# NEUT-001: self-hosting-verification domain leak

## Problem

`agent-framework/src/self-hosting/self-hosting-verification.ts` serializes THIS repository's process into
the published library: `DEFAULT_BASE_REF='origin/develop'`, `pnpm --filter <scope> test/typecheck/build`,
and `pnpm harness:verify -- --base-ref … --skip-record-check` ("Run Robota harness verification"), exported
via `index.ts`. Any consumer importing `planSelfHostingVerification` gets plans meaningful only inside this
repo — the exact "Robota-specific content in packages/" north-star violation. Worst finding of the
2026-07-24 neutrality audit (.design/audits/2026-07-24-neutrality-prompt-audit.md).

## What

Move the Robota-specific plan content to the composition root or an unpublished repo-side module
(`scripts/` tier). If a generic verify-before-swap planner is worth keeping in the library, it takes
`{ baseRef, commandTemplates }` as injected config with NO defaults naming pnpm/harness/origin-develop.
Update agent-framework SPEC + remove/replace the public export (breaking; beta line).

## Test Plan

Red-first: a test asserting the framework source contains no `harness:verify`/`origin/develop` literals
(becomes part of the NEUT-006 floor); existing self-hosting tests migrate with the code.

## Outcome (2026-07-25)

Evicted. `planSelfHostingVerification` now takes REQUIRED `{ baseRef, commandTemplates }`
(`ISelfHostingCommandTemplates`, `{scope}`/`{baseRef}` placeholders) with no defaults naming
pnpm/harness/origin-develop; the generic harness step became the optional injected `repoVerify`
gate. Robota's repo-process content moved to the unpublished
`scripts/harness/self-hosting-verification-commands.mjs`. Red-first floor added:
`packages/agent-framework/src/__tests__/repo-process-neutrality.test.ts` (asserts no
`harness:verify`/`origin/develop`/`pnpm --filter` literals in framework source); existing
self-hosting tests migrated to injected templates. Breaking (beta line); SPEC updated.
