---
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-core': patch
---

A PreToolUse `command` hook can now steer a tool call, not only refuse it. The permission gate
applies the winning `hookSpecificOutput.permissionDecision`:

- `allow` skips the prompt a person would otherwise get. Deny rules, refusals from the mode, the
  `auto` mode classifier and asks that must reach a person (an `ask` rule, a protected path, a
  policy that asks about everything) still apply.
- `ask` sends the call to a person even when the mode or a remembered consent would run it. The
  answer is not remembered, and with no one to ask the call is refused.
- `defer` leaves the call to the normal flow, as before.

Before this change these decisions were read and then ignored.

`updatedInput` is still not applied: the call runs the input it was made with, and an `allow` sent
with an `updatedInput` is not applied either, since it approved another input.

`runHooks` (agent-core) now reads a decision and an `updatedInput` only from `command` hooks: a
`prompt` or `agent` hook answers from a model that reads the tool input it judges, so it can only
refuse. With several hooks, `ask` now outranks `defer` (`deny` > `ask` > `defer` > `allow`), and the
reported `updatedInput` is the one sent with the winning decision.
