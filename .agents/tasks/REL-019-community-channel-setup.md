---
title: 'REL-019: Set up community channel (GitHub Discussions or Discord)'
status: todo
created: 2026-05-25
priority: low
urgency: post-launch
area: .github/, README.md, content/
depends_on: []
---

## Background

No community channel (Discord, GitHub Discussions, Slack, forum) is linked from any
entry point: root README, docs homepage, CONTRIBUTING.md, or getting-started.

A developer who hits a problem or wants to ask a question has no visible support path.
This is a growth limiter: developers who can't get help move on.

Source: pre-release PM audit P3, L1 (2026-05-25).

## Change Required

**Option A (minimal — recommended first):** Enable GitHub Discussions on the repo.
Add a "Community" section to root README and `content/README.md` linking to Discussions.
Add to `CONTRIBUTING.md`.

**Option B:** Create a Discord server. Link from README, docs homepage, CONTRIBUTING.md.

Either option is fine. GitHub Discussions requires zero setup overhead.

## Acceptance Criteria

- At least one community channel is linked from root README and docs homepage
- CONTRIBUTING.md mentions where to ask questions
