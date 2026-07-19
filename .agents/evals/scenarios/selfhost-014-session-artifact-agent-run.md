# SELFHOST-014 — async share → resume session artifact (AGENT-RUN capability verification)

Closes the capability-reachability done-gate (TC-04 + TC-08): the agent built and ran the functional tests
proving the **async, durable share → resume** path end-to-end — export a session to a portable artifact, hand it
off, import it into a **second, independent store** (a different surface), and resume there, **with the source
offline and with redaction**. This is the async complement to REMOTE-001's live channel; no live wire, no pairing.
Per [`.agents/rules/backlog-execution.md`](../../rules/backlog-execution.md) and the
[SELFHOST-014 spec](../../spec-docs/active/SELFHOST-014-shared-async-session-artifacts.md) TC-04/TC-08.

Run by the agent on 2026-07-19: `pnpm --filter @robota-sdk/agent-session test` +
`pnpm --filter @robota-sdk/agent-framework test`.

## What was exercised (functional tests, real stores)

- **TC-01 round-trip fidelity** — `deserializeSessionArtifact(serializeSessionArtifact(record))` deep-equals a
  full-field `ISessionRecord` (no redaction). The full-fidelity local form.
- **TC-04 async share across two independent surfaces** — `store A.save(record)` →
  `serializeSessionArtifact(A.load(id))` → `store B.save(deserialize(artifact))` (B has a **different baseDir**;
  A may be offline) → `B.load(id)` matches the source `messages`/`history`/`goal`, and the two stores are
  independent (distinct file paths).
- **TC-07 export-for-share redact seam** — `serialize(record, { redact })` with an app-supplied transform that
  strips `cwd`/`sandboxSnapshotId` and composes the opt-in `scrubSensitiveKeys` produces an artifact whose secrets
  are `[REDACTED]` and whose stripped fields are absent — while the no-redact form retains them.
- **TC-08 redacted artifact still resumes on B with import-side rebind** — `redact` strips the required `cwd` →
  import on B → the app rebinds B's own `cwd` → the record resumes with `messages`/`history`/`goal` intact.
- **TC-03 existing resume path** — an imported artifact saved into a store rehydrates `history`/`goal` through the
  UNCHANGED `loadSessionRecord` path (agent-framework), proving no new resume machinery was introduced.

```
$ pnpm --filter @robota-sdk/agent-session test        # incl. session-artifact.test.ts, scrub-sensitive.test.ts
  Tests  117 passed (117)
$ pnpm --filter @robota-sdk/agent-framework test       # incl. session-artifact-resume.test.ts (TC-03)
  Tests  1214 passed (1214)
```

## Verdict

The neutral artifact envelope + the opt-in scrub deliver the async durable share→resume capability over the
**existing** `ISessionRecord` (no new format): a thread can leave the machine that produced it, be redacted on the
share path (app-owned field policy), imported into an independent surface, and resumed there through the existing
`loadSessionRecord` path — with both peers offline. Neutrality (no link/cloud/access/field policy in the envelope)
is mechanically fenced by `scan-session-artifact-neutrality` (TC-05) + the `deps` scan (TC-06, no edge to the live
REMOTE-001 stack).
