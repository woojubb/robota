---
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-ui-terminal': minor
---

`robota session attach <id> [--observe]` puts this terminal on a live supervised session.

- It asks first, on the controlling terminal, naming the session and the role: drive (send prompts,
  answer its questions) or observe (read only). The yes holds only for the process start it named: if
  the session restarted meanwhile, the attach is refused.
- It needs an interactive terminal. Without one (a script, or an agent running shell commands) it is
  refused and prints the command for the user to run. It is not available as a slash command or a
  model tool.
- The terminal view shows the conversation so far, then follows the session live: streaming replies,
  tools, other terminals' prompts, queued input and questions. In drive mode it sends prompts and
  `/commands` and answers permission prompts and questions; a question answered on another surface is
  dismissed. Observe mode is labelled read-only and sends nothing but reads.
- `/exit`, `/quit`, Ctrl-C and Ctrl-] detach. Nothing is sent to the session, so its turn continues and
  it keeps running; stop it with `robota session stop` or from `robota session view`.
- `agent-ui-terminal` exports `renderAttachedSessionView`.
- A handshake from a connection that already closed no longer holds one of the session's attach slots.
