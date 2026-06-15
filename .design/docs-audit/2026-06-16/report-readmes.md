# Docs Audit Report — READMEs (2026-06-16)

Scope: root `README.md`, `packages/*/README.md` (25), `apps/*/README.md` (3). Ground truth: 19 public
`@robota-sdk/*` packages, version 3.0.0-beta.76, beta.76 transport split + new agent-session-analytics.

## Summary

- Reviewed: 26 READMEs. Stale: **6**. Placeholder/empty: 0 (new packages all have real content).
- Dominant theme: references to **package splits that never shipped** (`agent-plugin-*`,
  `agent-command-*` are consolidated into single `agent-plugin` / `agent-command`) + a few phantom
  package names. The transport split IS correctly reflected in transport READMEs.

## Findings

### packages/agent-cli/README.md

- **high** — Dependency table lists non-existent `@robota-sdk/agent-transport-headless` (line ~538).
  Headless folded into `@robota-sdk/agent-transport` (`./headless` sub-path). Fix: replace with
  `agent-transport` + note `./headless`.
- **low** — `--model` example uses `claude-opus-4-7` while doc elsewhere uses `claude-sonnet-4-6`
  (line ~135). Fix: align example model id.

### packages/agent-core/README.md

- **medium** — "What Moved Out in v3" + architecture describe a per-plugin package split that did not
  ship; plugins ship consolidated in `@robota-sdk/agent-plugin`. Evidence: `@robota-sdk/agent-plugin-*`
  (line ~133), "8 extracted packages" (line ~106). Fix: → `@robota-sdk/agent-plugin`.
- **low** — Architecture diagram uses non-existent plurals `agent-sessions/agent-providers/agent-plugins/agent-sdk`
  (lines ~103–108). Fix: singular real names + `agent-framework`.
- **low** — Presents `@robota-sdk/agent-tool-mcp` (private/unpublished) as installable (line ~132).

### packages/agent-framework/README.md

- **high** — Code sample imports non-existent `@robota-sdk/agent-command-skills` (lines ~238, ~261).
  Skills module lives in consolidated `@robota-sdk/agent-command` (`./skills`). Fix: → `agent-command`.
- **medium** — Lists individual plugin packages `agent-plugin-conversation-history…webhook` (line ~433)
  that don't exist. Fix: "consolidated `@robota-sdk/agent-plugin` exports all 8 plugins".
- **low** — Prose uses `agent-command-*` (lines ~43, 213) and old name `agent-sdk` for this package
  (lines ~343, 345, 382). Fix: `agent-command`, `agent-framework`.

### packages/agent-command/README.md

- **medium** — Command inventory stale: claims "All 20 factory functions" but package now exports 22
  modules; missing `/preset` and `/schedule` (verified: src/index.ts exports preset, schedule). Fix:
  add both + update count.

### README.md (root)

- **medium** — Architecture diagram + Packages table omit beta.76 changes; table lists only ~6 of 19
  public packages (no transport split, no agent-session-analytics/preset/command/plugin/executor/
  subagent-runner/interface packages). Fix: add new packages (or mark table as curated subset) +
  update diagram.

### apps/agent-server/README.md

- **high** — References non-existent `@robota-sdk/agent-remote-server-core` (line ~14); only
  `@robota-sdk/agent-remote-client` (private) exists. Fix: correct to actual location or describe
  in-app implementation.

## Clean files (17)

agent-session-analytics, agent-transport, agent-transport-{http,mcp,tui,ws}, agent-executor,
agent-interface-transport, agent-interface-tui, agent-plugin, agent-preset, agent-provider,
agent-session, agent-subagent-runner, agent-tools, apps/blog, apps/starter-nextjs. No vendor-name or
`sub-agent` hyphen violations. Transport split correctly documented in transport READMEs.
