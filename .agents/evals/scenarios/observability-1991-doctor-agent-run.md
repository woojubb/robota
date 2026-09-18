# OBSERVABILITY-1991 — Pre-session doctor: broken HOME, repair, clean run (agent-run)

**Spec:** `.agents/spec-docs/active/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md`
**Task:** `.agents/tasks/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md`
**Type:** agent-executable — the agent drives the built CLI (`node packages/agent-cli/bin/robota.cjs`, the
shipped `robota` entrypoint, built from this branch) non-interactively against an isolated `HOME`; no
live LLM, provider call, credential or external service. The only network step is a TCP connect to the
closed loopback port `127.0.0.1:9`.

## Scenarios

Three runs on one isolated `HOME` and one `git init`'d empty project directory, with
`ROBOTA_DOCTOR_MARKER=sk-doctor-marker-env-1a2b3c` exported and no provider key variables:

1. **Broken HOME** — zero-byte `~/.robota/settings.json`; `~/.claude/settings.json` =
   `{"defaultTrustLevel":42}`; plugin `broken-plugin` with manifest `{`; plugin `mcp-plugin` whose
   `.mcp.json` names the stdio command `robota-doctor-missing-binary` with `env.GHOST_TOKEN` =
   `sk-doctor-marker-mcp-9f8e7d`. Command: `robota doctor`.
2. **Repair** — same HOME, `robota doctor --repair settings.user.robota --yes` (stdin is not a TTY).
3. **Clean** — `~/.claude/settings.json` and `~/.robota/plugins` removed; `~/.robota/settings.json`
   replaced with a valid document whose active profile resolves its key from `$ENV:ROBOTA_DOCTOR_MARKER`
   with `baseURL` `http://127.0.0.1:9`, plus an inactive profile carrying the literal
   `sk-doctor-marker-profile-4d5e6f`. Command: `robota checkup`.

## Expected

- Run 1: exit `1`; the zero-byte path with `empty`/`fail`; the schema-invalid path with
  `schema-invalid`, `fail`, issue path `defaultTrustLevel` and no received value; the broken manifest
  path skipped with its cause; server `ghost` / command `robota-doctor-missing-binary` at `warn`;
  `mcp.activation` `not-configured`; a repair offer containing `--repair settings.user.robota`;
  `storage.user` `ok`; `grep -c sk-doctor-marker` = 0.
- Run 2: exit `1` (the schema-invalid layer still fails); `settings.user.robota` `ok`; no repair
  offer remains for it; `~/.robota/settings.json` is exactly `{}`; `~/.claude/settings.json`
  byte-identical to before; marker count 0.
- Run 3: exit `0`; `settings.user.robota` `ok`; provider line naming `anthropic` and
  `claude-sonnet-4-6`; reachability line naming `127.0.0.1` at `warn`; `mcp.activation`
  `not-configured`; `storage.user` `ok`; no `fail` line; marker count 0 although the environment
  variable and the inactive profile carried markers.

## Observed (2026-09-19)

Isolated `HOME` = `/tmp/robota-1991-home-5cTc`, project = `/private/tmp/robota-1991-proj-Yzcm`,
Node v24.13.0, `robota 3.0.0-beta.79` (branch build).

### Run 1 — `robota doctor` (exit 1, marker hits 0)

```text

robota doctor

  ✓ Node.js version [host.node] ok: v24.13.0
  ✓ robota version [host.cli] ok: 3.0.0-beta.79
  ✓ Terminal [host.terminal] ok: unknown
  ✗ Settings layer [settings.user.robota] fail: empty
      path: /tmp/robota-1991-home-5cTc/.robota/settings.json
      The file exists but holds nothing; rewriting it as {} loses no content.
      repair: robota doctor --repair settings.user.robota
  ✗ Settings layer [settings.user.claude] fail: schema-invalid: defaultTrustLevel (invalid_type)
      path: /tmp/robota-1991-home-5cTc/.claude/settings.json
      Session start will refuse this configuration. Fix the file at the named path.
  ⚠ Merged settings [settings.merge] warn: partial — a present layer is broken; session start will refuse this configuration
      (no key declared by a healthy layer)
  ✗ Provider [provider.resolution] fail: Settings file /tmp/robota-1991-home-5cTc/.robota/settings.json contains invalid JSON: Unexpected end of JSON input. Fix or delete the file, or run robota diagnose.
      Run: robota --configure, or set the provider API key variable.
  ⚠ Workspace trust [workspace.trust] warn: untrusted
      path: /private/tmp/robota-1991-proj-Yzcm
      Project sources are disabled. Run: robota trust --yes
  ✓ User storage [storage.user] ok: writable, owner-only
      path: /tmp/robota-1991-home-5cTc/.robota
  ○ Project storage [storage.project] not-configured: project sources are disabled in an untrusted workspace
  ✓ Plugins [plugins] ok: 1 plugin(s) loaded
      /tmp/robota-1991-home-5cTc/.robota/plugins: 1 loaded, 1 skipped
  ✗ Plugin [plugin.broken-plugin@fixture-market] fail: manifest could not be parsed
      path: /tmp/robota-1991-home-5cTc/.robota/plugins/cache/fixture-market/broken-plugin/1.0.0/.claude-plugin/plugin.json
      SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)
  ○ Skills and commands [skills] not-configured: no skill or command root present
  ○ Hooks [hooks] not-configured: no command hooks configured
  – Hook execution [hooks.execution] not-probed: the doctor does not run hooks
  ○ MCP activation [mcp.activation] not-configured: this CLI composes no MCP activation adapter
  ⚠ MCP server (plugin) [mcp.plugin.mcp-plugin@fixture-market.ghost] warn: stdio command robota-doctor-missing-binary not found on PATH
      path: /tmp/robota-1991-home-5cTc/.robota/plugins/cache/fixture-market/mcp-plugin/1.0.0/.mcp.json
      env keys: GHOST_TOKEN
  – MCP connection [mcp.connection] not-probed: the doctor does not connect to MCP servers

✗ 4 issue(s) found. Fix the items above to use robota.
  repairable: settings.user.robota — run with --repair <check-id> (asks before writing; --yes skips the prompt)


```

### Run 2 — `robota doctor --repair settings.user.robota --yes` (exit 1, marker hits 0)

```text
Repaired settings.user.robota: rewrite the empty user settings file as {}.
  ✓ Settings layer [settings.user.robota] ok: ok
  ✗ Settings layer [settings.user.claude] fail: schema-invalid: defaultTrustLevel (invalid_type)
✗ 3 issue(s) found. Fix the items above to use robota.
```

Post-run readback: `~/.robota/settings.json` = `{}`; `~/.claude/settings.json` byte-identical to the
pre-run copy (`cmp` exit 0); no repair offer for `settings.user.robota` remains.

### Run 3 — `robota checkup` (exit 0, marker hits 0, `fail` lines 0)

```text

robota checkup

  ✓ Node.js version [host.node] ok: v24.13.0
  ✓ robota version [host.cli] ok: 3.0.0-beta.79
  ✓ Terminal [host.terminal] ok: unknown
  ✓ Settings layer [settings.user.robota] ok: ok
      path: /tmp/robota-1991-home-5cTc/.robota/settings.json
  ○ Settings layer [settings.user.claude] not-configured: absent
      path: /tmp/robota-1991-home-5cTc/.claude/settings.json
  ✓ Merged settings [settings.merge] ok: 2 key(s) from 1 layer(s)
      currentProvider: replace ← /tmp/robota-1991-home-5cTc/.robota/settings.json
      providers: object-merge ← /tmp/robota-1991-home-5cTc/.robota/settings.json
  ✓ Provider [provider.resolution] ok: anthropic (claude-sonnet-4-6) — settings profile
  ⚠ Provider reachability [provider.reachability] warn: 127.0.0.1:9 (profile baseURL) unreachable: connect ECONNREFUSED 127.0.0.1:9
      Check proxy settings, firewall, or the profile baseURL.
  ⚠ Workspace trust [workspace.trust] warn: untrusted
      path: /private/tmp/robota-1991-proj-Yzcm
      Project sources are disabled. Run: robota trust --yes
  ✓ User storage [storage.user] ok: writable, owner-only
      path: /tmp/robota-1991-home-5cTc/.robota
  ○ Project storage [storage.project] not-configured: project sources are disabled in an untrusted workspace
  ○ Plugins [plugins] not-configured: no plugin cache directory
      /private/tmp/robota-1991-proj-Yzcm/.robota/plugins
      /tmp/robota-1991-home-5cTc/.robota/plugins
  ○ Skills and commands [skills] not-configured: no skill or command root present
  ○ Hooks [hooks] not-configured: no command hooks configured
  – Hook execution [hooks.execution] not-probed: the doctor does not run hooks
  ○ MCP activation [mcp.activation] not-configured: this CLI composes no MCP activation adapter
  – MCP connection [mcp.connection] not-probed: the doctor does not connect to MCP servers

⚠ 2 warning(s). robota may work but check the items above.


```

### Supporting test suites

- `packages/agent-framework/src/config/__tests__/settings-inspection.test.ts` — layer states, structured
  causes, provenance, `loadConfig` parity (TC-02)
- `packages/agent-framework/src/plugins/__tests__/bundle-plugin-inspection.test.ts` — skipped plugins,
  keys-only MCP typing, report-only hooks validation (TC-05)
- `packages/agent-framework/src/commands/__tests__/skill-source-inspection.test.ts` — silent skill skips
  (TC-05)
- `packages/agent-command/src/doctor/__tests__/doctor-runner.test.ts` — statuses, redaction including the
  parse-error-adjacent secret, host tiers, repair gates and idempotence (TC-03, TC-04, TC-05, TC-07)
- `packages/agent-command/src/doctor/__tests__/doctor-command-module.test.ts` — `/doctor` without a
  provider turn; cancelled / absent interaction writes nothing (TC-06)
- `packages/agent-cli/src/startup/__tests__/doctor-route.test.ts` — three names, route flags,
  composition-throw → check, `--repair`/`--yes` gates (TC-01)
