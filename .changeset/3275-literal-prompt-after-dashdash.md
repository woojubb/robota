---
'@robota-sdk/agent-cli': patch
---

Words after `--` are the prompt, never a subcommand or a flag. `robota -p -- init` used to run `robota init` (and `eval`, `user-local` or `mcp` likewise ran or refused as those commands), and a prompt spelling `--attach`, `--safe-mode` or `--restricted-workspace` acted as that flag; now each is sent to the model as text. A subcommand or flag given before `--` works as before.
