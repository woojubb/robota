/**
 * Forgetting while the agent runs: the chats the process holds are cleaned in memory and on disk, and
 * the chat whose forget is running is cleaned once its turn ends, with nothing it saves in between
 * carrying the fact back.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createFixtureWebRoot, loginClient, startHarness } from './harness.js';

import type { IHarness } from './harness.js';

const FACT = 'The vault code is 4471-ZETA';

let harness: IHarness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

function holders(dir: string): string[] {
  return filesUnder(dir).filter((file) =>
    readFileSync(file, 'utf8').toLowerCase().includes('4471-zeta'),
  );
}

const remember = {
  tool: 'WikiRemember',
  args: { page: 'Home', kind: 'matter', claim: FACT, origin: 'owner' },
} as const;

async function settled(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !check(); attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 50));
}

describe('forgetting in a running agent', () => {
  it('cleans an idle chat in memory and on disk, and the next request never carries the fact', async () => {
    harness = await startHarness({ gui: true, webRoot: createFixtureWebRoot() });
    harness.model.script({ text: 'Noted.' });
    await harness.submit(`Remember this: ${FACT}`);
    const { claimId } = await harness.capabilities.wiki.remember({
      pageTitle: 'Home',
      kind: 'matter',
      claim: FACT,
      source: { origin: 'owner', sessionId: harness.local.primary.sessionId },
    });
    expect(holders(harness.stateDir).length).toBeGreaterThanOrEqual(2);

    const api = await loginClient(harness);
    const answer = await api.send('POST', 'wiki/forget', { claimId });
    expect(answer.status).toBe(200);
    const body = answer.body as {
      removed: number;
      conversations: { cleaned: number; pending: number; notReached: number; sources: string[] };
      stays: string[];
    };
    expect(body.removed).toBe(1);
    expect(body.conversations).toMatchObject({ cleaned: 1, pending: 0, notReached: 0 });
    expect(body.conversations.sources).toHaveLength(1);
    // The answer names what stays, in the plan's words, and never repeats the fact.
    expect(body.stays.join(' ')).toMatch(/paraphrase/u);
    expect(body.stays.join(' ')).toMatch(/file paths, addresses, folders/u);
    expect(body.stays.join(' ')).toMatch(/feed.*cases/u);
    expect(JSON.stringify(answer.body)).not.toMatch(/4471/u);

    expect(holders(harness.stateDir)).toEqual([]);
    expect(JSON.stringify(harness.local.primary.getMessages())).not.toContain('4471');

    harness.model.script({ text: 'Hello again.' });
    await harness.submit('What did I tell you?');
    const request = harness.model.requests.at(-1)!;
    expect(JSON.stringify(request.messages)).not.toContain('4471');
    expect(JSON.stringify(request.messages)).toContain('[forgotten]');
    await settled(() => holders(harness!.stateDir).length === 0);
    expect(holders(harness.stateDir)).toEqual([]);
  });

  it('cleans the chat whose forget is running when its turn ends, and every save meanwhile', async () => {
    harness = await startHarness();
    harness.model.script(
      remember,
      { tool: 'WikiForget', args: { text: 'vault code' } },
      { text: 'Forgotten.' },
    );
    const turn = await harness.submit(`Remember this, then forget it: ${FACT}`);
    expect(turn.text).toContain('Forgotten');
    // The forget found the chat busy: it was owed, not reached, while the turn ran.
    const results = harness.model.requests
      .flatMap((request) =>
        request.messages.filter((message) => message.role === 'tool').map((m) => String(m.content)),
      )
      .join('\n');
    expect(results).toContain('"pending":1');
    const memoryClean = (): boolean =>
      !JSON.stringify(harness!.local.primary.getMessages()).includes('4471');
    await settled(() => holders(harness!.stateDir).length === 0 && memoryClean());
    expect(holders(harness.stateDir)).toEqual([]);
    expect(memoryClean()).toBe(true);
    // Paid in full: nothing is held for later.
    const [id] = harness.local.conversations.live().map((session) => session.sessionId);
    expect(harness.local.conversations.owed.redactorFor(id!)).toBeUndefined();
  });
});
