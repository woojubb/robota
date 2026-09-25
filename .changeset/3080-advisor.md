---
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-cli': minor
---

Advisor escalation: the main model can consult a second model at the decision points it chooses.

With an advisor configured (`--advisor <profile>[:<model>]`, or the `advisorModel` setting that
`/advisor` saves; the flag wins), the session gets an `Advisor({ question? })` tool. The advisor reads
the whole conversation — system prompt, messages, tool calls and results — serialized into one prompt
and sent with `toolChoice: 'none'`, truncated from the front to fit its window with the system prompt
kept, and declines when even that does not fit. Its answer comes back framed as guidance to verify;
an empty or refusing answer reads as declined. Calls are limited to two per turn and a fixed number
per session, and a repeated question in the same turn returns the earlier answer. Advisor usage, including
in-process subagents', is recorded in the session totals, and `/cost` prices it at the advisor's rate.

`/advisor <model>` and `/advisor off` change only where calls go, never the tool list, so the main
model's prompt cache is not invalidated mid-session; the tool is added only when a session starts with
an advisor. Sending history to a destination (provider type and endpoint) the main model does not already
use needs a one-time consent per destination, kept in the user settings file, and the organization's
`allowedProviders` applies. Parallel calls in one round share the limits; a call that fails does not
use one up, and provider failures are reported by class, never by their text.
`ROBOTA_DISABLE_ADVISOR=1` turns it off completely. In-process subagents inherit the advisor, bound to
their own conversation; child-process subagents do not get it.

- `agent-session` — `formatConversationEntries`, the one text rendering of a conversation, now used by
  compaction too. It keeps tool calls and results, marks a user message a peer session sent
  (`user [from "peer:<id>"]`), and JSON-encodes every message onto one line so no content can forge
  another entry; compaction previously flattened all of this. `getSessionTokenUsage` also reports
  the part of the totals that carried its own price (`separatelyPriced`).
- `agent-framework` — `AdvisorController`, `createAdvisorTool`, the advisor spec helpers, and the
  optional `advisor` command host adapter. Session assembly binds a host-supplied Advisor tool to the
  session holding it.
- `agent-command` — the `/advisor` command module.
- `agent-cli` — the `--advisor` flag, `advisorModel` setting, per-destination consent store and kill switch.
