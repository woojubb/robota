---
'@robota-sdk/agent-session': minor
---

PreToolUse hooks can now steer a tool call, not only refuse it. The permission gate applies the
winning `hookSpecificOutput.permissionDecision`:

- `allow` skips the approval prompt the call would otherwise need. Deny rules, refusals from the
  mode and asks that must reach a person (an `ask` rule, a protected path, a policy that asks about
  everything) still apply.
- `ask` sends the call to a person even when the mode or a remembered consent would run it. The
  answer is not remembered, and with no one to ask the call is refused.
- `defer` leaves the call to the normal flow, as before.

`hookSpecificOutput.updatedInput` replaces the call's input before the rules judge it, so the rules,
the prompt and the tool see the rewritten input. A rewrite that cannot reach what runs refuses the
call: an action checked on a tool's behalf, arguments a tool has already fixed, or an `updatedInput`
that is not an object. The session log records a rewrite as `tool_input_updated`.

Before this change these fields were read and then ignored, so a configured hook that answered
`allow` still met the prompt and one that rewrote the input had no effect.
