---
title: 'PROV-011: Vercel AI Gateway — researched, and declined with the measurements that decided it'
status: done
created: 2026-08-22
completed: 2026-08-22
priority: medium
urgency: later
area: packages/agent-provider-openai-compatible, packages/agent-provider-defaults
depends_on: []
---

# PROV-011: the gateway works, and this repository is not taking it

Registered as [issue #1930](https://github.com/woojubb/robota/issues/1930), which required research
before any decision and named "do not adopt" as a successful outcome. That is the outcome, and this
file exists so the next person does not repeat the research to reach it.

## The decision

**Not adopted.** Not because it does not work — every technical question resolved in its favour — but
because the cost is a new external dependency and a new single point of failure on the path of every
model call, and the benefit is reach this repository does not currently need.

Six providers are wired directly today and they work. The gateway's offer is one key for 351 models
across 35 providers. That is a real gain the day someone needs a provider we do not carry; it is not
a gain today, and it is not free.

## What was measured, so it is not re-measured

Verified against the live endpoint with a real key, not from documentation.

| Question                                     | Answer                                                              |
| -------------------------------------------- | ------------------------------------------------------------------- |
| Catalog                                      | 351 models, 35 providers, one key. `GET /v1/models`                 |
| Streaming                                    | works — `chat.completion.chunk` frames                              |
| Tool calling                                 | works                                                               |
| **Forced `tool_choice`**                     | **works**, including on an Anthropic model through the OpenAI shape |
| Structured outputs (`json_schema`, `strict`) | works on BOTH an OpenAI and an Anthropic model                      |
| Reasoning                                    | works — `reasoning_effort` in, `reasoning_tokens` out               |

### The item's own strongest objection was falsified

Issue #1930 argued that gateway fallback swaps the provider mid-request, which would be hidden
non-determinism in this runtime. Two distinct features, and neither behaves that way:

- **Provider routing** (`order` / `only` / `sort`) is the default and does NOT change the model — it
  selects among hosts serving the same model. `anthropic/claude-opus-5` via Vertex is still that
  model.
- **Model fallback** (`models` array) is **opt-in**. Absent, nothing swaps. Present, the response
  reports what served it: `.model`, plus `modelAttempts` with per-attempt `canonicalSlug`/`modelId`.

The concern is real for this repository — `resolveStructuredOutputCapability` yields
`response_schema` / `json_object` / `none` depending on the pair, so a mid-request model change
would leave the built request and the executing model disagreeing. But the answer is "do not pass
`models`", not "do not use the gateway".

### Two behaviours that would have to be handled, if it is ever adopted

1. **The requested model id and the served one can differ.** `openai/gpt-5-fast` came back as
   `openai/gpt-5` with no fallback configured. Anything keying on the requested id rather than
   `response.model` keys on the wrong thing.
2. **`usage` carries real cost** — `cost`, `gateway_cost`, `market_cost`, `is_byok`. This repository
   hard-codes `costPerTokenUsd` per definition; the gateway reports measured cost instead of an
   estimate. That is an improvement worth remembering.

### Placement, if it is ever adopted

One `IProviderDefinition` in `agent-provider-openai-compatible`. The contract already fits: one
`type`, one base URL, one key, one `modelCatalog`. The gateway's ids are namespaced
(`provider/model`) and therefore string-disjoint from the bare ids the direct providers use, so
"one model, two names" needs no mapping owner — they are two providers with disjoint catalogs and a
session picks one. The catalog is enumerable from `GET /v1/models` rather than hand-maintained.

### Key issuance, measured because the issue asked

The issue's table says the REST path needs no dashboard. Measured, that is misleading for the FIRST
key:

    GET  /v2/user                 200   (the gateway key can read the account)
    GET  /v1/api-keys             403   "You don't have permission to list the api key."
    POST /v1/api-keys             403   "You don't have permission to create the api key."

An AI Gateway key can call the gateway and cannot manage keys, so the REST path presupposes a token
obtained another way — which is the dashboard or `vercel login`.

And the device flow is closed to third parties, which the docs page hides and the discovery document
reveals:

- `https://vercel.com/.well-known/openid-configuration` advertises `device_code` AND a
  `registration_endpoint`; `/docs/sign-in-with-vercel/authorization-server-api` mentions neither and
  states `grant_type` is "Either `authorization_code` or `refresh_token`".
- RFC 7591 dynamic registration is open WITHOUT authentication — a loopback `redirect_uris` returns
  **201** and a `client_id`.
- But `device_code` is **silently dropped** from the granted `grant_types`, and using the endpoint
  answers `401 unauthorized_client`. `vercel login`'s device flow is Vercel's own first-party client.

So a CLI's only path is `authorization_code` + PKCE + loopback, and a browser approval is
unavoidable either way.

## Prior Art Research

Read from product documentation, not source.

|                | Vercel AI Gateway               | OpenRouter               | Cloudflare AI Gateway                  |
| -------------- | ------------------------------- | ------------------------ | -------------------------------------- |
| base URL       | one                             | one                      | **one per provider**                   |
| model id       | `provider/model`                | `provider/model`         | provider-native                        |
| key            | one gateway key (BYOK optional) | one                      | own provider key OR Cloudflare-managed |
| model fallback | **opt-in**                      | **automatic by default** | present                                |

Cloudflare does not solve the placement problem at all: the URL carries the provider and the body
uses native ids, so it is a per-provider proxy — adopting it would mean a URL prefix on the six
definitions that already exist. And OpenRouter's Auto Router does by default the thing this issue
feared, which Vercel leaves off.

## Test Plan

None. Nothing shipped. The measurements above were made against a live endpoint with a key supplied
for the research and destroyed after it; they are recorded here because re-running them costs a key
and an account.

## User Execution Test Scenarios

Not applicable: no behaviour changed. The verification that mattered was the live-call table above.

## What would reopen this

- a provider this repository wants that no direct package carries
- wanting measured per-call cost rather than the estimated `costPerTokenUsd`
- provider outages becoming frequent enough that same-model host routing is worth a dependency
