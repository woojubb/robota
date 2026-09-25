---
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': major
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-ui-terminal': patch
'@robota-sdk/agent-session-analytics': patch
---

Advisor escalation: the main model can consult a second model at the decision points it chooses.

With an advisor configured (`--advisor <profile>[:<model>]`, or the `advisorModel` setting that
`/advisor` saves; the flag wins), the session gets an `Advisor({ question? })` tool. The advisor reads
the whole conversation — system prompt, messages, tool calls and results — serialized into one prompt
and sent with `toolChoice: 'none'`, truncated from the front to fit its window with the system prompt
kept, and declines when even that does not fit. Its answer comes back framed as guidance to verify;
an empty or refusing answer reads as declined. Calls are limited to two per turn and a fixed number
per session, parallel calls in one round share those limits, and a repeated question in the same
turn returns the earlier answer. A request that was sent counts even when the provider failed (the
decline is reported by class, never by its text); only a call declined before sending gives its slot
back.

Advisor usage, including in-process subagents', is recorded where each turn's usage is recorded —
the persisted session history, under the advisor's own provider and model — so `/cost`, usage reports
and resumed sessions include it. `/cost` now totals that history and prices each part on its own
model, showing "mixed" when more than one model was priced.

`/advisor <model>` and `/advisor off` change only where calls go, never the tool list, so the main
model's prompt cache is not invalidated mid-session; the tool is added only when a session starts
with an advisor. Sending history to a destination (provider type and endpoint host) the main model
does not already use needs a one-time consent per destination, kept in the user settings file; a
refusal is remembered for the session. The organization's `allowedProviders` applies, and
`ROBOTA_DISABLE_ADVISOR=1` turns it off completely. In-process subagents inherit the advisor, bound
to their own conversation; child-process subagents do not get it.

**`@robota-sdk/agent-framework` is `major` for one reason: `ICommandHostSessionAccess` gains a
required member,** `getSessionUsage()`, the session's persisted usage records. An external
implementation of that role port stops compiling until it adds the method. The rest is additive.

- `agent-session` — `formatConversationEntries`, the one text rendering of a conversation, now used
  by compaction too. It keeps tool calls and results, marks a user message a peer session sent
  (`user [from "peer:<id>"]`), and JSON-encodes every message onto one line so no content can forge
  another entry; compaction previously flattened all of this. `Session.getProvider()` returns the
  provider the session currently uses.
- `agent-framework` — `AdvisorController`, `createAdvisorTool`, the advisor spec helpers, provider
  destinations (`describeProviderDestination`, `rememberProviderDestination`), `getSessionUsage` and
  `ISessionUsageRecord`, the `onUsageRecorded` session option, and the optional `advisor` command
  host adapter. Session assembly binds a host-supplied Advisor tool to the session holding it.
- `agent-command` — the `/advisor` command module; `/cost` reads the session's persisted usage.
- `agent-cli` — the `--advisor` flag, `advisorModel` setting, per-destination consent store and kill
  switch.
- `agent-ui-terminal` — a usage line from another source (the advisor, a background task) names that
  source and leaves out the context window it does not have.
- `agent-session-analytics` — personal usage counts an advisor call's tokens and cost toward its
  turn without counting it as a turn.
