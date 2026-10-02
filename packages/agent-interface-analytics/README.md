# @robota-sdk/agent-interface-analytics

The usage and run-trace contracts of the Robota SDK: how many tokens a turn used, what it cost,
which execution unit, model, provider and product surface it is attributed to, the per-turn
timeline a trace view renders, and the cross-session personal-usage report.

The package contains type declarations only, with no classes and no runtime code. It declares the
shape of a measurement; it measures nothing and decides no policy. It has no dependencies at all,
not even `@robota-sdk/agent-core`.

## Installation

```bash
npm install @robota-sdk/agent-interface-analytics
```

## Usage

A surface that shows the cost of a turn reads an `IUsageSnapshot`:

```ts
import type { IUsageSnapshot } from '@robota-sdk/agent-interface-analytics';

function formatUsage(usage: IUsageSnapshot): string {
  const cost =
    usage.costUsd === undefined
      ? 'cost unknown'
      : `${usage.costStatus === 'estimated' ? '~' : ''}$${usage.costUsd.toFixed(4)}`;
  return `${usage.totalTokens} tokens, ${usage.contextUsedPercentage}% of context, ${cost}`;
}
```

`costStatus` states confidence in the number, not success or failure: an unpriced model is
`unknown` and has no `costUsd`, and a cost computed from a local price table is `estimated`.

## What it defines

| Family                     | Main types                                                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-turn usage             | `IUsageSnapshot`, `IUsageSource`, `IUsageObservation`, `IUsageModelShare`, `TUsageSurface`                                                                                  |
| Per-session report         | `IUsageBySourceReport`, `IUsageSourceTotals`, `IRunTraceTurn`, `IRunTraceSpan`, `ISpanEntry`                                                                                |
| Live prompt trace          | `ILivePromptTraceBatch`, `IProviderCallTraceEntry`, `IToolBodyTraceEntry`, `IToolPermissionDecisionEntry`                                                                   |
| Opt-in live content        | `ILivePromptContentPolicy`, `ILivePromptContentBatch`, `ILivePromptContentItem`, `ILivePromptContentToolRef`, `TLivePromptContentKind`, `TLivePromptContentOmitted`         |
| Personal usage (7/30 days) | `IPersonalUsageRequest`, `IPersonalUsageReport`, `IPersonalUsageTotals`, `IPersonalUsageDay`, `IPersonalUsageDimension`, `IPersonalUsageActivity`, `IPersonalUsageCoverage` |

Usage, trace and personal-usage types carry counts, timings, identifiers and attribution only.
Prompt, response, file path and tool payload text never appear in them.

Prompt, response and tool text is a separate, opt-in contract. A host states what it wants
captured in an `ILivePromptContentPolicy`, and the text arrives in its own
`ILivePromptContentBatch`, joined to the content-free trace only by the prompt's trace and span
IDs. A consumer that never asks for content never holds any.

## Where it sits

- Depends on nothing.
- `@robota-sdk/agent-framework` records usage observations and the live prompt trace (and, when
  a host opts in, live content) as a turn runs.
- `@robota-sdk/agent-session-analytics` assembles reports: `summarizeUsageBySource` returns an
  `IUsageBySourceReport`, `summarizePersonalUsage` returns an `IPersonalUsageReport`.
- `@robota-sdk/agent-transport` carries usage reports in its wire messages, and transports such as
  `@robota-sdk/agent-transport-ws` tag the turns they accept with a `TUsageSurface`.
- `@robota-sdk/agent-ui-terminal` renders per-turn usage.
- `@robota-sdk/agent-interface-session` names `IUsageSnapshot` and `TUsageSurface` in its turn and
  submit contracts.

## Documentation

- [`docs/SPEC.md`](docs/SPEC.md) — the contract, the boundaries, and why the package has no
  dependencies.

## License

This package is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
