---
title: 'REL-018: Remove or implement GitHub Action integration doc'
status: done
done_at: 2026-05-25
created: 2026-05-25
priority: medium
urgency: before-stable
area: content/integrations/
depends_on: []
---

## Background

`content/integrations/github-action.md` documents a GitHub Action:

```yaml
- uses: robota-sdk/action@v1
```

The repository `github.com/robota-sdk/action` **does not exist** and returns 404.

Any developer who follows this integration guide (e.g., to add automated PR review to their CI)
will hit a 404 when trying to use the Action. This is directly misleading for a documented
production feature.

Source: pre-release PM audit P3 (2026-05-25).

## Resolution Options

**Option A (remove — fast):** Remove `content/integrations/github-action.md` or replace with
a placeholder: "GitHub Action coming soon — track [issue #X]."

**Option B (implement):** Create the `robota-sdk/action` GitHub repository with a working
Action that wraps `@robota-sdk/agent-cli`. Minimum viable: `uses: robota-sdk/action@v1` with
`anthropic-api-key` and `task` inputs.

Option A is the safe path until the Action is ready.

## Acceptance Criteria

One of:

- `content/integrations/github-action.md` is removed or clearly marked "Coming Soon"
- OR `github.com/robota-sdk/action` exists and the documented usage works
