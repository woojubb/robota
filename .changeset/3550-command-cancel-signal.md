---
'@robota-sdk/agent-interface-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-cli': patch
---

**A command's caller can cancel what a skill command starts, including while the skill is prepared.**

`ISessionCommands.executeCommand` takes an optional trailing `{ signal }`. For a skill command it
reaches the turn the skill submits or the fork it runs, and the work before them: a cancel stops the
skill's activation (a shell expression already running finishes, nothing after it runs), refuses a
turn not yet started and interrupts one that is, and stops a fork. A command cancelled this way
rejects with the signal's reason whichever step the cancel reached, and a cancelled fork is not
recorded as an error. Before, a cancel that landed before the skill submitted its turn found nothing
for `abort()` to stop, and the turn then ran; a fork skill run as a command ignored the cancel. A
command that starts neither a turn nor a fork ignores the signal; every existing call keeps its shape.

A fork skill now receives the signal of whatever runs it, so a fork the model starts inside a turn
stops when that turn is aborted instead of running on.

`robota acp` hands each `/command` prompt's signal to the command, so `session/cancel` stops a skill
command's turn or fork even when it lands before the turn has started.
