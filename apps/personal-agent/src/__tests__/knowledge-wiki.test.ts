import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { offeredTools, toolResults } from './scripted-model.js';
import { startHarness } from './harness.js';

import type { IHarness } from './harness.js';

let harness: IHarness | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await harness?.close();
  harness = undefined;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-agent-wiki-'));
  dirs.push(dir);
  return dir;
}

describe('knowledge wiki in the personal agent', () => {
  it('offers the wiki tools and tells the model to keep the wiki', async () => {
    harness = await startHarness();
    harness.model.script({ text: 'ok' });
    await harness.submit('hi');
    const request = harness.model.requests[0]!;
    expect(offeredTools(request)).toEqual(expect.arrayContaining(['WikiIndex', 'WikiSearch', 'WikiRemember', 'WikiForget']));
    const system = String(request.messages.find((message) => message.role === 'system')?.content);
    expect(system).toContain('knowledge wiki');
  });

  it('answers in a later session from what an earlier session filed, not from the transcript', async () => {
    const dir = stateDir();
    harness = await startHarness({ stateDir: dir });
    harness.model.script(
      { tool: 'WikiRemember', args: { page: 'Mina', kind: 'person', claim: 'Mina is allergic to peanuts', origin: 'owner' } },
      { text: 'Noted: Mina is allergic to peanuts.' },
    );
    const first = await harness.submit('Remember that Mina is allergic to peanuts.');
    expect(first.text).toContain('Noted');
    expect(readFileSync(join(dir, 'wiki', 'pages', 'mina.md'), 'utf8')).toContain('Mina is allergic to peanuts');
    await harness.close();

    // A new process and a new session: the only way to know is the wiki.
    harness = await startHarness({ stateDir: dir });
    harness.model.script(
      { tool: 'WikiSearch', args: { query: 'Mina allergy' } },
      (request) => ({ text: `From my notes: ${toolResults(request).join(' ')}` }),
    );
    const second = await harness.submit('What should I avoid when cooking for Mina?');
    const firstRequest = harness.model.requests[0]!;
    expect(JSON.stringify(firstRequest.messages)).not.toContain('allergic to peanuts');
    expect(second.text).toContain('Mina is allergic to peanuts');
    expect(second.text).toContain('owner said');
  });

  it('forgets on request so the fact is gone from the wiki files', async () => {
    const dir = stateDir();
    harness = await startHarness({ stateDir: dir });
    harness.model.script(
      { tool: 'WikiRemember', args: { page: 'Gifts', kind: 'matter', claim: 'Wants a red bicycle for the birthday', origin: 'owner' } },
      { text: 'Saved.' },
    );
    await harness.submit('Remember the gift idea.');
    harness.model.script({ tool: 'WikiForget', args: { text: 'red bicycle' } }, { text: 'Forgotten.' });
    await harness.submit('Forget the bicycle idea.');
    expect(existsSync(join(dir, 'wiki', 'pages', 'gifts.md'))).toBe(false);
    expect(await harness.capabilities.wiki.recall('bicycle')).toBe('No wiki pages match.');
  });
});
