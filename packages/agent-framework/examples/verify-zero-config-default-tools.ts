import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';

import { createAgentRuntime, type InteractiveSession } from '../src/index.js';

/**
 * ARCH-035 S-1 — a zero-config session still receives the default tool tier, and
 * `IAgentRuntime.createSession` stays SYNCHRONOUS.
 *
 * Both halves matter, and the second is the trap. ARCH-035 moved the default tool set into
 * `@robota-sdk/agent-tool-defaults` and made `agent-framework` reach it by dynamic `import()`, which
 * turned the assembly `createSession` async. `IAgentRuntime.createSession` survives synchronous only
 * because it does NOT call that function — it constructs the session directly and the assembly happens
 * later behind `initializeInteractiveSessionAsync`. That indirection is load-bearing rather than
 * incidental: an implementer propagating async "until it compiles" would very plausibly make this
 * return a Promise and break every consumer that builds a session without supplying `defaultTools` —
 * `createQuery` and the headless runtime have no `defaultTools` seam at all, so they could not opt back
 * in.
 *
 * The tool list is read from what the PROVIDER was actually asked to use, not from the session. The
 * framework exposes no public accessor for a built session's final tool list, so the scripted
 * provider's recorded request is the observable channel — the same data a user sees in
 * `.robota/logs/<id>.jsonl`.
 */
const PROMPT = 'ARCH-035 zero-config default tools';
const RESPONSE = 'ARCH-035 ok';

/** The tier a zero-config session must receive. Measured before the extraction, asserted after it. */
const EXPECTED_TOOLS = [
  'AskUserQuestion',
  'BackgroundProcess',
  'Bash',
  'Edit',
  'Glob',
  'Grep',
  'Read',
  'Shell',
  'WebFetch',
  'WebSearch',
  'Write',
  'report_goal_status',
];

function assertCondition(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), 'arch-035-example-'));
  let session: InteractiveSession | undefined;
  let result:
    { createSessionReturnedSynchronously: boolean; providerObservedTools: string[] } | undefined;

  try {
    const script = createScriptedProvider([{ text: RESPONSE }]);
    const runtime = createAgentRuntime({ cwd, provider: script.provider });

    // No `defaultTools` anywhere — this is the zero-config path the extraction exists to preserve.
    const created = runtime.createSession({});
    const createSessionReturnedSynchronously = !(created instanceof Promise);
    assertCondition(
      createSessionReturnedSynchronously,
      'IAgentRuntime.createSession returned a Promise — the async propagation escaped its one hop, and ' +
        'every consumer that builds a session without `defaultTools` is broken',
    );
    session = created;

    const handle = await session.submit(PROMPT);
    const { response } = await handle.completed;
    assertCondition(
      response === RESPONSE,
      `scripted provider did not reply as recorded: ${response}`,
    );

    // `chatOptions` entries are `IChatOptions | undefined`, and a tool's descriptor is nested under
    // `function` for the provider wire shape — read defensively and let the assertions below say what
    // was actually observed rather than throwing an opaque TypeError.
    const observed = script.chatOptions.flatMap((options) => options?.tools ?? []);
    const providerObservedTools = observed
      .map(
        (tool) =>
          (tool as { name?: string; function?: { name?: string } }).name ??
          (tool as { function?: { name?: string } }).function?.name,
      )
      .filter((name): name is string => typeof name === 'string')
      .sort();
    assertCondition(
      providerObservedTools.length > 0,
      'the provider was offered NO tools — the default tier did not reach the session, which is the ' +
        'silently-toolless-agent failure this scenario exists to catch',
    );
    assertCondition(
      providerObservedTools.join(',') === EXPECTED_TOOLS.join(','),
      `default tool tier changed: ${providerObservedTools.join(',')}`,
    );

    result = { createSessionReturnedSynchronously, providerObservedTools };
  } finally {
    await Promise.allSettled([session?.shutdown()]);
    rmSync(cwd, { recursive: true, force: true });
  }

  assertCondition(result !== undefined, 'scenario did not produce a result');
  assertCondition(!existsSync(cwd), 'scenario cleanup did not remove its temporary directory');
  process.stdout.write(
    `${JSON.stringify({ scenario: 'ARCH-035', ...result, cleanupRemoved: true })}\n`,
  );
}

await main();
