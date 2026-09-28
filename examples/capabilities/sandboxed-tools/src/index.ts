/**
 * Robota capability demo — the agent's tools run in a SANDBOX, not on the host.
 *
 * Two things are shown, and the second is the interesting one.
 *
 * 1. Composing a sandboxed tool surface. `createDefaultTools` takes an optional `sandboxClient`, and
 *    every file tool it builds then reads and writes through that client instead of the host
 *    filesystem. The client here is `InMemorySandboxClient` so the demo is self-contained and
 *    destroys nothing; swapping in `E2BSandboxClient` points the same tools at a real remote sandbox
 *    with no other change.
 *
 * 2. What a child-process subagent of a sandboxed parent needs.
 *
 *    Child-process subagents are rebuilt from a RECIPE: the child receives the execution root and a
 *    serialized profile, and composes an equivalent tool surface at its own root. A live sandbox
 *    client cannot cross that process boundary — it is an open session, not data — but a sandbox
 *    TYPE and a SNAPSHOT id can. The composition root registers a constructor for each type
 *    (`sandboxFactories` in the subagent worker composition), and the child builds a client of that
 *    type and restores the snapshot.
 *
 *    A client that cannot produce a snapshot, or whose type has no registered constructor, is
 *    refused: the product will not spawn children that would silently fall back to HOST tools.
 */
import process from 'node:process';

import { InMemorySandboxClient } from '@robota-sdk/agent-tools';
import { createDefaultTools } from '@robota-sdk/agent-tool-defaults';

const SANDBOX_FILE = '/workspace/notes.txt';
const SANDBOX_CONTENT = 'written inside the sandbox, never on the host\n';

function report(label: string, value: unknown): void {
  process.stdout.write(`${label}: ${JSON.stringify(value)}\n`);
}

async function main(): Promise<void> {
  // ── 1. A sandboxed tool surface ────────────────────────────────────────────────────────────────
  const sandboxClient = new InMemorySandboxClient();
  await sandboxClient.writeFile(SANDBOX_FILE, SANDBOX_CONTENT);

  const cwd = process.cwd();
  const hostTools = createDefaultTools({ cwd });
  const sandboxedTools = createDefaultTools({ cwd, sandboxClient });

  // On a sandbox with its own filesystem the set differs: Glob and Grep have no sandbox path, so
  // they are withheld rather than left searching the host while edits land in the sandbox.
  report(
    'toolNames',
    sandboxedTools.map((tool) => tool.getName()),
  );
  report(
    'sameToolSetWithAndWithoutSandbox',
    hostTools.map((t) => t.getName()).join(',') ===
      sandboxedTools.map((t) => t.getName()).join(','),
  );

  // The file exists in the sandbox and was never written to the host.
  report('readBackFromSandbox', await sandboxClient.readFile(SANDBOX_FILE));

  // ── 2. What crosses to a child-process subagent ────────────────────────────────────────────────
  //
  // A snapshot reference is just a string, so it is carryable; the child also needs the constructor
  // for this sandbox type, which only the composition root can register.
  const snapshotId = await sandboxClient.snapshot();
  report('snapshotIdIsSerializable', typeof snapshotId === 'string');
  report(
    'whatCrossesTheBoundary',
    'the sandbox type and a snapshot id; the child rebuilds the client with the constructor registered for that type',
  );
  report(
    'withoutASnapshotOrConstructor',
    'refuse to compose, rather than spawn children that would silently use HOST tools',
  );
}

await main();
