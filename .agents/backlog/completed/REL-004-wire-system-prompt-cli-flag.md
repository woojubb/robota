---
title: 'REL-004: Wire --system-prompt CLI flag or remove from docs'
status: done
done_at: 2026-05-25
created: 2026-05-25
priority: critical
urgency: immediate
area: packages/agent-cli, content/guide/cli.md
depends_on: []
---

## Background

`content/guide/cli.md:28` documents `--system-prompt <text>` as:

> "Override the system prompt for this session"

At runtime (`packages/agent-cli/src/modes/print-mode.ts:42–44`):

```typescript
// TODO: wire --system-prompt once IInteractiveSessionStandardOptions adds systemPrompt field
if (args.systemPrompt) {
  process.stderr.write('Warning: --system-prompt is not yet functional and will be ignored.\n');
}
```

The flag is silently discarded. A developer building a script that relies on prompt override
will get wrong behavior with no obvious error. Source: pre-release dev audit G4 (2026-05-25).

## Resolution Options

**Option A (wire it — preferred):**
`IInteractiveSessionStandardOptions` already has `systemPrompt?: string` (line 53).
`print-mode.ts` needs to pass `args.systemPrompt` to the session options.
The infrastructure is already there — this is a one-line wire-up.

**Option B (remove from docs):**
Remove `--system-prompt` from `content/guide/cli.md` flag table and from the CLI `--help` output.
Add a comment to the source noting it is not yet exposed.

## Acceptance Criteria

One of:

- `robota --print --system-prompt "You are a code reviewer" "review this"` uses the given prompt, OR
- `--system-prompt` is absent from `cli.md` and from `robota --help` output
