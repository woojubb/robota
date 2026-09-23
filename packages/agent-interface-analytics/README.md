# @robota-sdk/agent-interface-analytics

Analytics contract interfaces for the Robota SDK — usage snapshots, per-source totals and run-trace
timelines, plus provider-neutral cross-session personal-usage reports.

Type declarations only: no classes, no runtime logic. This package declares the **shape of a
measurement**; it measures nothing and decides no policy.

```ts
import type {
  IUsageSnapshot,
  IUsageBySourceReport,
  IPersonalUsageRequest,
  IPersonalUsageReport,
  IRunTraceTurn,
} from '@robota-sdk/agent-interface-analytics';
```

Personal-usage contracts contain only aggregate counts, calendar buckets, attribution dimensions,
coverage diagnostics, and contributing session IDs. Prompt, response, path, and tool-payload content
are deliberately outside the contract.

See [`docs/SPEC.md`](docs/SPEC.md) for the full contract and the boundaries.

## License

AGPL-3.0-only OR LicenseRef-Commercial
