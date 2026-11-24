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
- **Nothing is startable, or called ready, until the host has verified what it needs.** A task is shown
  as available only from the host's own check of its capability bindings; a service's description of its
  tools creates no binding. Without a verified binding a definition is unavailable and says so.
- **Source text stays data.** An offer's reason, suggestions and references are bounded values the person
  reads. Nothing turns them into a definition's instructions, a capability or a decision.
- **The catalog is the owner's and local.** Built-in definitions ship with the product; offers and
  installed definitions live in the owner-only state directory. No hosted catalog or recommendation
  service is needed to browse.

## Non-goals

- No hosted catalog, recommendation service or third-party intermediary.

## Design decisions

- A repeat observation updates the evidence of the offer that has its key instead of adding a card, and
  an observation never chooses an offer's decision: a new offer starts open and only the person's own
  choice changes it, so a source that keeps noticing the same thing neither fills the page nor reopens
  what was dismissed.
