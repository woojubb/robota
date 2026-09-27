---
'@robota-sdk/agent-cli': patch
'@robota-sdk/agent-ui-terminal': minor
---

Starting a session from `robota session view` in a folder that is not trusted asks what to do
instead of failing. The choices are `y` to trust the folder and start, `r` to start it Restricted,
and `n` to cancel. Before, the view showed only "Start failed".

- `agent-cli` (patch):
  - A background session started Restricted runs with `--restricted-workspace`.
  - A headless start that asked to run Restricted is no longer refused for want of trust, the same
    as `--safe-mode`.
- `agent-ui-terminal` (minor): the session view takes `startNeedsTrust`, and `onStart` receives the
  person's choice (`TSupervisedStartTrustChoice`).
