# @robota-sdk/agent-interface-analytics

Analytics contract interfaces for the Robota SDK — usage snapshots, per-source totals and run-trace
timelines.

Type declarations only: no classes, no runtime logic. This package declares the **shape of a
measurement**; it measures nothing and decides no policy.

```ts
import type {
  IUsageSnapshot,
  IUsageBySourceReport,
  IRunTraceTurn,
} from '@robota-sdk/agent-interface-analytics';
```

See [`docs/SPEC.md`](docs/SPEC.md) for the full contract and the boundaries.

## License

AGPL-3.0-only OR LicenseRef-Commercial
