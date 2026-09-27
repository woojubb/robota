# @robota-sdk/agent-interface-analytics — documents

Usage and run-trace contracts for the Robota SDK: per-turn token and cost snapshots, per-source
session reports and run timelines, the live prompt trace, opt-in live prompt/response/tool content,
and the cross-session personal-usage report. Type declarations only, with no dependencies. The
package declares the shape of a measurement; it measures nothing.

## Usage

```typescript
import type {
  IUsageSnapshot,
  IUsageBySourceReport,
  ILivePromptContentBatch,
  IPersonalUsageReport,
} from '@robota-sdk/agent-interface-analytics';
// Contract declarations only. agent-framework records usage as a turn runs;
// agent-session-analytics assembles the reports; agent-transport carries them over the wire.
```

The usage, trace and personal-usage types never carry prompt, response, path or tool-payload
text. That text is a separate opt-in contract (`ILivePromptContentPolicy`,
`ILivePromptContentBatch`) linked to the trace only by its IDs.

## Documents

- [SPEC.md](./SPEC.md) — package contract, type ownership, boundaries, and why this package has an
  empty dependency set.
