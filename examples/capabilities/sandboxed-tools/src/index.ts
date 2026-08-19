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
 * 2. Why a sandboxed parent cannot spawn CHILD-PROCESS subagents (ARCH-033).
 *
 *    Child-process subagents are reproduced from a RECIPE: the child receives the execution root and
 *    a serialized profile, and rebuilds an equivalent tool surface at its own root. A recipe can
 *    carry anything that is a pure function of (root, payload, durable state). It cannot carry a
 *    live handle — and a sandbox client IS one: an open session against a remote machine, holding
 *    state no serialized payload reproduces.
 *
 *    So the product refuses to compose rather than spawning children that would silently fall back
 *    to HOST tools. That refusal is the safe direction: a sandboxed parent with host-tool children is
 *    ARCH-010's shape, where the measured breach was a subagent reading outside its root.
 *
 *    `ISandboxClient` does declare `snapshot()` / `restore(snapshotId)`, so a sandbox is in principle
 *    projectable — the child could restore from a snapshot reference. What is missing is not the
 *    snapshot but the CONSTRUCTOR: the child must be able to build the same client type, and only the
 *    composition root knows which type that is. Designing that projection is ARCH-033; this example
 *    is the executable statement of the problem it solves.
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

  // The SET is the same either way — sandboxing changes where a tool acts, not which tools exist.
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

  // ── 2. Why this parent cannot spawn child-process subagents ────────────────────────────────────
  //
  // A snapshot reference IS carryable — it is just a string. The demo takes one to make the point
  // concrete: the missing half is the constructor on the other side, not the state.
  const snapshotId = await sandboxClient.snapshot();
  report('snapshotIdIsSerializable', typeof snapshotId === 'string');
  report(
    'whatARecipeCannotCarry',
    'the live client itself — an open session the child cannot rebuild from (root, payload, durable state) alone',
  );
  report(
    'productBehaviourToday',
    'refuse to compose, rather than spawn children that would silently use HOST tools (ARCH-021)',
  );
}

await main();
