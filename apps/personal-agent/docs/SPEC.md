# robota-personal-agent — SPEC

## Purpose

The personal agent: a long-running assistant for one person, served to its own web UI and an HTTP API
on loopback, composed from the SDK without the CLI. It keeps what is the person's — what the agent
knows about them, its goals, cases and ideas, the services it is connected to, and the work it can take
on — in the person's own state directory.

## Contract

- **Definitions and offers are separate records.** A task definition is the product's reusable,
  versioned promise of work: what it needs, the most it may do and how success is checked, by a rule the
  host implements for that revision, so the definition's own words decide nothing. An offer is a
  reason one definition is relevant to this person now. An offer can lapse, be snoozed, be dismissed or be
  superseded without the definition changing, and a published revision never changes.
- **Nothing is called ready until the host has verified what it needs, every time it is shown.** The host
  works out each definition as ready, needing one named setup step, or unavailable with its reason, from
  bindings it maintains itself and the person's live connectors and browser. A service's tool names,
  descriptions and read-only claims create or widen no binding, and a definition's or offer's words
  change nothing. Values a task asks for are collected when the person starts it, and the host judges the
  task again at that moment, so nothing a page showed earlier is trusted.
- **One Start is one request and at most one goal.** The host keeps the person's request on disk before
  any goal exists, then makes the goal with the request's id as typed data on it, never as text in its
  instructions. A retry, a second tab or a restart in between gets that same request and goal back. A
  request whose task needs setup is kept and waits; once ready it starts on the access it named, a new
  or changed account or access waits for the person to look again, and a request that no longer rests
  on the task, access and values it was made from, or waited too long, is ended, never started later.
  The goal can use only the tools its bound capabilities allow and reach only the addresses the
  request named, and nothing the person typed or a page says adds a tool or an address.
- **Completed means the host proved it.** When a started task's goal has ended, the host decides once how
  it ended: failed, cancelled, verified or unverified. Verified needs the revision's rule satisfied by
  receipts the host's own browser recorded during that run; a model's report, a page's text and anything
  typed are never evidence, and a run that ended without that proof is reported unverified, never as
  completed. The decision is made by whichever comes first of the run's end, a read of the launch and the
  host's start, and nothing changes it afterwards.
- **Source text stays data.** An offer's reason, basis, suggestions and references are bounded values the
  person reads, the reason and basis judged by the value they carry and not by their vocabulary. Nothing
  turns them into a definition's instructions, a capability or a decision.
- **The agent proposes, the host gates, the person decides.** The agent may propose an offer for an
  installed task revision from something it read, but it cannot publish a definition, grant a capability
  or start a task, and only a sync run and a case turn, each with a bound of its own, have the tool: the
  owner's chats and every other run are denied it. The host's gate judges every proposal when it is made, whenever the offers are shown
  and again when a task is started from one: the task must be installed at that revision, its source a
  connected service or library page that is still there and was read recently enough, no case may be open
  on the same item, the values it suggests must pass the checks a start makes, and a run and a day have
  bounds. Nothing the agent wrote changes the gate's answer. An offer is accepted only by the task being
  started from it, which keeps the launch beside the offer; how the run ended is recorded apart from that,
  so accepted but unfinished work is never counted as success. Offers are shown on the page the person
  opens; they interrupt nobody unless the person chose to be told, and then only under the same limits as
  questions.
- **Forgetting a fact also removes its words from the saved conversations, and says how far that went.**
  What the library forgets is replaced by a marker in every chat, messenger conversation, goal run and
  side-chat title that holds the same words, with each conversation otherwise intact and still
  resumable. A conversation another writer holds, one waiting on an execution, or one that cannot be
  read is never written to and is reported as not reached; one that is running is cleaned when its turn
  ends. The answer to the person names what was reached and what stays.
- **The catalog is the owner's and local.** Built-in definitions ship with the product; offers and
  installed definitions live in the owner-only state directory. No hosted catalog or recommendation
  service is needed to browse.

## Non-goals

- No hosted catalog, recommendation service or third-party intermediary.

## Design decisions

- A second request for the same task and values while the first one's goal is still under way gets that
  launch back: a second tab or an impatient second click is the same wish, and the same work is a new
  request only once the first has ended.
- The goal's wording is the host's own, written for one reviewed revision of a task, and what the person
  typed is one JSON object of data inside it, so a value cannot close its own quotation or add a tool.
- A started run reads pages through a browser made for that run alone. It opens only the address the
  person named: it refuses every other address before the browser is asked, withholds what a redirect or
  the page itself led to, and records the refusal, so a run that tried is never called verified. The
  prompt asks the model to stay on the page and only the host decides, and an outcome decided afterwards
  cannot unmake a read. The browser also records each page it returns before the model sees it. A record
  kept around the shared browser could not tell one run's reads from another's, and the model's own
  account of its work could not be told from proof at all. The browser keeps one page between runs, so a
  look at the page it was left on proves nothing: the run must itself have opened the page it was asked
  about, and the browser must have landed on exactly that address, since even a redirect inside the site
  can end at a login or an error page. The report that was judged is kept with the outcome, so a rerun
  or a removed goal cannot change what the person was told.
- A repeat observation updates the evidence of the offer that has its key instead of adding a card, and
  an observation never chooses an offer's decision: a new offer starts open and only the person's own
  choice changes it, so a source that keeps noticing the same thing neither fills the page, reopens
  what was dismissed nor wakes what was snoozed, and an offer that lapsed unanswered waits out a
  cooldown before the same matter makes another. Nothing a repeat says moves backward: one dated before
  what the offer rests on changes nothing, and the expiry, and with it the cooldown, only grows. The
  agent's reference to an item is kept in one spelling (compatibility form, lower case, single spaces),
  for the key and for the comparison with an open case, so a variant spelling cannot dodge a dismissal, a
  cooldown or a case. Decisions and cooldowns are read from the stored offers, so a restart cannot reset
  them.
- What the person chose about offers (on or off, Feed, push or digest, topics, muted topics and sources)
  is theirs alone: only their own request changes it, no tool the agent can call reaches it, and words that
  cannot be read count as off, so damage never undoes an opt-out. The choice comes before the gate: what is
  off or muted is not proposed, shown or started from an offer, wherever the offer already stands, while
  a task the person starts themselves is theirs to start. A new offer is handed to the shared delivery
  once, and only when its task is ready; a repeat observation, a restart or a task that was not ready then
  never tells the person later, and only the task's own title, never a word from the source or the agent,
  is sent. What the host decided about telling the person is kept apart from the person's reactions, so a
  held-back offer never reads as one the person met.
- The host cannot fetch an item from a connected service by the agent's own reference, so an offer from
  one rests on the service still being connected and on the age of the observation, not on the item
  being read again; a library page is looked up by its id.
- A forget cleans a conversation the agent is running only when it is idle, and owes the rest: a turn keeps its whole conversation in memory and saves it whole, so a cleaned file would be rewritten with the fact by that turn's next save. Until it ends, what the turn saves is cleaned on the way to disk and the text is held only in memory; deleting the conversation was rejected because it takes everything else the person said, and keeping the forgotten text to clean later would keep the fact. The wiki is cleaned first and the reach follows, so a reach that fails is reported and never brings the fact back.
