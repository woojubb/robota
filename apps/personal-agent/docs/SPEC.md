# robota-personal-agent — SPEC

## Purpose

The personal agent: a long-running assistant for one person, served to its own web UI and an HTTP API
on loopback, composed from the SDK without the CLI. It keeps what is the person's — what the agent
knows about them, its goals, cases and ideas, the services it is connected to, and the work it can take
on — in the person's own state directory.

## Contract

- **Definitions and offers are separate records.** A task definition is the product's reusable,
  versioned promise of work: what it needs, the most it may do and how success is checked. An offer is a
  reason one definition is relevant to this person now. An offer can lapse, be dismissed or be superseded
  without the definition changing, and a published revision never changes.
- **Nothing is called ready until the host has verified what it needs, every time it is shown.** The host
  works out each definition as ready, needing one named setup step, or unavailable with its reason, from
  bindings it maintains itself and the person's live connectors and browser. A service's tool names,
  descriptions and read-only claims create or widen no binding, and a definition's or offer's words
  change nothing. Values a task asks for are collected when the person starts it, and the host judges the
  task again at that moment, so nothing a page showed earlier is trusted.
- **One Start is one request and at most one goal.** The host keeps the person's request on disk before
  any goal exists, then makes the goal with the request's id as typed data on it, never as text in its
  instructions. A retry, a second tab or a restart in between gets that same request and goal back; a
  request that no longer rests on the task, access and values it was made from is ended, never started
  later. The goal can use only the tools its bound capabilities allow, and nothing the person typed or a
  page says adds one.
- **Source text stays data.** An offer's reason, suggestions and references are bounded values the person
  reads. Nothing turns them into a definition's instructions, a capability or a decision.
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
- A repeat observation updates the evidence of the offer that has its key instead of adding a card, and
  an observation never chooses an offer's decision: a new offer starts open and only the person's own
  choice changes it, so a source that keeps noticing the same thing neither fills the page nor reopens
  what was dismissed.
