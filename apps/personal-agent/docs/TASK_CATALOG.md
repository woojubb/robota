# Task catalog and runnable recommendations

## Outcome

The person can browse useful work, choose a recommendation, and start it from the card. A ready
recommendation starts one background task immediately. If a required account, permission, choice, or
input is missing, the card asks for that exact prerequisite and resumes the same request when it is
ready. Choosing a recommendation authorizes an attempt, not every action the task might take.

This is a design for capabilities that can be connected over time. A card must never imply that a
service or action works before the host has verified it. The catalog is useful without any hosted
recommendation service or third-party intermediary.

## Distinct records

| Record | Meaning | Ownership and lifetime |
| --- | --- | --- |
| **Task definition** | A reusable, versioned promise of work, its required inputs and capabilities, permitted kinds of effect, and how success is checked. | Product definitions ship with the app; owner-installed definitions live in owner state. A published revision is immutable. |
| **Offer** | A reason this definition is relevant to this person now, with optional prefilled inputs and source references. | Owner state. It can be accepted, dismissed, expired, or superseded without changing the definition. |
| **Launch intent** | The person's one request to run an exact definition revision with exact inputs. | Owner state from click through setup, execution, and recovery. It has one idempotency key and one eventual goal. |
| **Run evidence** | The resulting goal, actions, approvals, source receipts, and outcome. | Existing goal and Feed stores, linked to the launch. |

Definitions and offers are different from `Ideas` and `Cases`. An Idea is a thought that waits for
the person; a Case is an agent-owned matter already being worked. Either may produce an offer, but
neither becomes an executable definition merely because it mentions a task. Existing Goals remain the
execution record, not the catalog.

```mermaid
flowchart LR
  BuiltIn[Built-in definitions] --> Catalog[Versioned catalog]
  Owner[Accepted owner drafts] --> Catalog
  Observation[Agent observations] --> Offers[Owner's offers]
  Catalog --> Offers
  Offers --> Readiness[Host readiness check]
  Bindings[Verified capability bindings] --> Readiness
  Readiness --> Intent[Durable launch intent]
  Intent --> Goal[Goal runner]
  Goal --> Feed[Feed and evidence]
```

### Definition contract

A definition has a stable ID and revision; a plain-language title, category, and expected result;
typed required inputs and safe defaults; semantic capability requirements; an effect ceiling; a
completion-evidence rule; and an execution mode. The execution mode is a one-shot Goal by default.
Recurrence is a separate, explicit owner choice. The definition contains no credentials, personal
data, provider token, or text copied from a tool response as instructions.

Capabilities describe operations such as searching a connected source or drafting an action, not
arbitrary MCP tool names. A host-maintained binding maps each operation to an adapter, account, exact
tool, argument boundary, and effect classification. A server's tool description and `readOnly` hint
are untrusted claims; they cannot create a binding or lower its effect class. A definition that needs
an unverified operation is visible as unavailable, never marked ready.

Built-in definitions are reviewed with the product. The person may save a successful task as a draft
definition and accept it for later use. The agent may propose drafts or attach a trusted definition
to an observation, but it cannot publish a draft, grant a capability, or start an offered task on its
own. A future shared catalog would be an optional import path with its own review and provenance;
local and self-hosted operation cannot depend on it.

### Offer contract

An offer references a definition ID and revision, its source (`built-in`, `owner`, or `agent`), a
short reason, bounded context references, creation and expiry, and the owner's decision. A stable
deduplication key prevents repeated observations from filling the page with copies. Prefilled values
are suggestions, not authority; the person can inspect and change them. Source text from a mail,
page, or connector is displayed as data and is never promoted into definition instructions.

The catalog can begin with locally bundled definitions and an editorial order. Later, accepted
agent observations, saved successful work, and owner choices can fill the offer store. Ranking can
use relevance and readiness, but dismissal and privacy controls belong to the person. Request counts
measure interest; only independently checked outcomes count as completed work. Personal activity
stays in owner state unless the person explicitly opts into aggregation.

## Proactive offers

An offer can be made without an open chat or page, but only while the personal-agent host is running.
Connected-source sync and due Goals provide the first triggers. An authenticated event from a source
can be another trigger when that source supports one. An owner-enabled, scheduled review of Library
and open Goals can find opportunities without a new external item. Each trigger has a durable cursor
or source reference and a bounded amount of work; waking the agent is not permission to browse every
connected account or start an unbounded model loop. A stopped local process cannot wake itself. A
continuously running installation is needed for timely delivery while the person's devices are off.

The agent may propose an offer candidate from information it was allowed to read. A candidate names
an installed definition revision, the exact source item and account, when it was observed, a short
factual basis, why acting now may help, and any suggested inputs. The host validates those fields,
keeps the source as untrusted data, and rejects a candidate that cannot be tied to a trusted
definition. An observation without such a definition may remain an Idea or Case; it is not advertised
as a runnable recommendation. A Case asks for a decision about a matter already found; an Offer
proposes optional work. The same source matter must not produce both an active Case question and an
interrupting Offer.

Before showing or sending a candidate, a host-owned gate checks that its source still exists or has
not been superseded, its evidence is current enough for the promised result, its inputs and account
are unambiguous, the person's topic and source preferences allow it, it has not already been
accepted or dismissed, and the definition is ready or has an exact setup path. The model can explain
relevance, but cannot override a failed gate. Rank eligible offers by the person's stated interests,
timeliness, expected benefit, readiness, and novelty; show the reason and source on the card. Begin
with explicit rules that can be inspected. Learn weights only from actual feedback, without making a
larger permission or notification allowance from that feedback.

Each offer has a stable key from definition, account, and source matter, plus an expiry and cooldown.
Repeated syncs update evidence on the same offer rather than making more cards or notifications.
The host rechecks relevance and readiness at delivery and again on click, since the source, account,
or permission may have changed. An outdated offer is withdrawn or explained, never launched with
stale facts. Offers and their decisions survive a restart; restarting cannot reset the cooldown or
send the same offer again.

Every eligible offer may appear in Browse and Feed. Outward interruption is a separate choice:
optional, ready offers are feed-only by default, and the person can enable notification or digest
delivery for chosen topics. Those deliveries share the person's daily limit, quiet hours, and digest
budget with Case questions, with a stricter per-source cooldown for offers. They cannot use Goal
report notifications to bypass that budget. A notification opens the exact offer and its evidence;
pressing it does not start the task. The person can dismiss, snooze, mute a topic or source, or turn
proactive offers off without disconnecting an account.

The offer store records eligibility and delivery decisions separately from owner reactions: shown,
opened, accepted, started, verified complete, dismissed, snoozed, and muted. Ignored or dismissed
offers should reduce similar interruptions, while accepted but unfinished work must not be counted
as success. A connector failure or lack of fresh evidence lowers confidence rather than fabricating
a recommendation. A low-confidence candidate can stay in Browse for inspection instead of being
pushed.

Quality is judged on real, consented use as well as deterministic fixtures. Replay source changes,
duplicates, late arrivals, revoked access, restarts, and adversarial source text; verify that no
unsupported card is called ready and no disallowed interruption escapes. Then review actual offers
for factual support, timeliness, usefulness, missed worthwhile opportunities, and interruption
regret. Record acceptance and verified completion separately, by source and topic. Do not claim that
proactivity works well from scheduler tests or notification delivery alone.

## Readiness and launch

The host computes readiness when the page is shown and again when the person presses **Start**. It
checks definition revision, required input, connected account identity, live credential state,
granted scopes, the person's per-tool decisions, installed browser or other local capabilities, and
the binding's effect policy. The result is one of:

- **Ready:** show the expected result, source/account, and kinds of access before the person starts.
- **Needs setup:** identify the missing input, account choice, sign-in, or permission, and take the
  person directly to that step. More than one eligible account requires an explicit choice.
- **Unavailable:** explain the missing capability or service support and keep **Start** disabled.

Pressing **Start** creates or retrieves a durable launch intent before any Goal is created. The
client supplies an idempotency key; the server also serializes acceptance of one offer so double
clicks and retries return the same launch. The intent holds the immutable definition revision,
resolved input values, selected account and capability bindings, offer origin, and owner identity.
It stores references to credentials, never their values.

If setup is needed, the intent waits. After sign-in or input, the host refreshes readiness and
resumes that intent automatically while the person's request is still current and unchanged. A
failed or abandoned setup stays pending or expires with a clear status; it does not silently start
later after authority has changed. If a permission, account, definition, or prefilled value changes,
the host asks the person to review the changed request before starting.

When ready, the coordinator attaches the launch ID to a new one-shot Goal and asks the existing
runner to start it. The link is typed metadata, not a string hidden in the Goal prompt. Reserving
the intent and recording that ID on the Goal allow recovery to find a Goal created just before a
crash and avoid creating a second one. A new definition revision never changes a running Goal.

During execution the host limits the session to the bound capabilities. At final dispatch it checks
again what the call may reach: for a connector operation, the exact connector, tool and allowed argument
shape; for a page, the one address the person named. Revoked access pauses or fails the task with an
explanation. The existing approval gate still holds each consequential action; a card click or OAuth
consent never approves sending, purchasing, publishing, or other consequential effects. Denial leaves
that action unperformed and is reported in the Feed.

The card opens the linked Goal immediately after launch. The Goal and Feed show progress, waiting
setup or approval, cancellation, partial results, and failure. A model's final message is a report,
not proof of completion: the definition's evidence rule must be satisfied by a source readback,
receipt, or another independently checked result. Work without that evidence is reported as
unverified, not counted as complete.

## Product boundaries

The personal-agent composition root owns built-in definitions, owner-state stores for definitions,
offers and intents, capability bindings, readiness, and launch coordination. A file adapter can
persist these under the owner-only state directory's `task-catalog/`; a storage port leaves room for
another host adapter. The private web UI provides a Browse view, card details, setup, and the linked
Goal/Feed journey through the existing owner-authenticated API. Browse can group definitions by
category and show the person's offers separately. An "often chosen" group requires an actual,
privacy-controlled aggregate; it must not show request counts as verified successes. Connector
discovery remains about *services*; it is not the task catalog.

The root schedules bounded candidate turns using the existing background runner. The personal pack
needs an offer record and Feed item contract, plus a delivery policy that counts optional offer
notifications and Case questions against the same owner limits. The root decides which verified
capability bindings a candidate can name. The UI exposes evidence and feedback controls; it never
turns a notification into an implicit launch.

The personal capability pack continues to own reusable Goal, Idea, Case, connector, and approval
contracts. Extend a neutral contract only where the launch needs a typed origin or a dispatch fence
that another product could use. Do not move the catalog's product choices into the SDK in advance.
The same owner-state and host contracts work in local and self-hosted modes.

## Delivery checks

Build this in independently verifiable pieces: persist and browse definitions and offers; resolve
readiness from verified bindings; start a one-shot Goal exactly once; preserve an intent through
setup and restart; then add evidence-backed outcomes and personalized ranking. The Browse view can
arrive before every connector family, but only definitions the host can start, and has not
called unavailable, offer **Start**; a definition that needs setup keeps the request until setup is done.

Before calling the flow complete, verify these behaviors with real host boundaries:

- A ready offer starts one Goal on a double click, returns that Goal after a retry or restart, and
  links its report and evidence back to the offer.
- Missing sign-in, input, or account choice resumes the same intent after completion; a revoked
  scope, changed account, or expired intent cannot launch under old authority.
- A changed definition revision leaves an active run intact. A denied action produces no external
  effect. Untrusted connector metadata or source content cannot widen the task's tool set.
- A run without source evidence is not marked completed. Local and self-hosted modes expose the same
  journey, with owner-only storage and no remote catalog dependency.
