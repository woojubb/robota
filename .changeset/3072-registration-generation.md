---
'@robota-sdk/agent-cli': patch
'@robota-sdk/agent-ui-terminal': patch
---

Supervised session control is bound to one process start.

- Each supervised session start writes a fresh random generation into its private registration. Its
  control endpoint echoes that generation in every reply and refuses any request that carries a
  different one, or none.
- `session view` keeps the generation each row was verified with. Stop and linked-PR opening send it,
  so a session that restarted under the same id since the row was shown is refused instead of acted
  on. A stop confirmation also refuses when the row's generation changed while it was open.
- `session stop`, `rename`, `link-pr` and `unlink-pr` read the generation at request time and the
  session itself checks it, closing the window between the liveness check and the action.
- A registration without a generation (written by an earlier version) is listed but never
  controllable; restart that session to control it again.
- The generation is never printed by `session list` in text or JSON.
