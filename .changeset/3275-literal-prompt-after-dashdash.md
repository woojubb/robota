---
'@robota-sdk/agent-cli': patch
---

Words after `--` are the prompt, never a subcommand. `robota -p -- init` used to run `robota init` (and `eval`, `user-local` or `mcp` likewise ran or refused as those commands); it now sends "init" to the model. A subcommand given before `--` works as before.
