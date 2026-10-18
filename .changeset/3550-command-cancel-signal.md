---
'@robota-sdk/agent-interface-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-cli': patch
---

**A command's caller can cancel the turn a skill starts, including while the skill is prepared.**

`ISessionCommands.executeCommand` takes an optional trailing `{ signal }`. For a skill command it
reaches the skill's preparation (its activation, shell expressions and a lazily loaded skill's
instructions) and the turn the skill submits, which is refused when the signal is already cancelled
and cancelled like any submission afterwards; a fork skill's run receives it too. Before, a cancel
that landed before the skill submitted its turn found nothing for `abort()` to stop, and the turn
then ran. A command that starts no turn ignores the signal; every existing call keeps its shape.

A fork skill now receives the signal of whatever runs it, so a fork started by the model inside a
turn stops when that turn is aborted instead of running on.

`robota acp` hands each `/command` prompt's signal to the command, so `session/cancel` stops a skill
command's turn even when it lands before the turn has started.
