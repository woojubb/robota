---
'@robota-sdk/agent-cli': patch
---

CLI fixes from the docs-refresh findings (#3275):

- `robota trust revoke` exits 0 when the revoke succeeds.
- `robota <subcommand> --help` (session, daemon, mcp, usage, trust, doctor, eval, init, open) prints that subcommand's help instead of running it, refusing an unknown option, or starting the terminal UI.
- `robota --help` lists every option the parser accepts (`--goal`, `--goal-max-iterations`, `--provider`, `--set-current`, `--type`, `--base-url`, `--api-key`, `--api-key-env`, `--settings-scope`, `--session-log`, `--serve`, `--restricted-workspace`, `--disable-update-check`), `--effort` lists `none` and `minimal`, and `--bare` is described as what it does: print mode without instruction files or plugins.
- `robota session start --background --restricted-workspace` starts a background session Restricted, as the headless trust refusal already suggested.
- `robota "prompt"` opens the terminal UI with the prompt typed in, not yet sent.
