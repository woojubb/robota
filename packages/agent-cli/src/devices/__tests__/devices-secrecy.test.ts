/**
 * The recovery phrase stays on the secret terminal. After `/devices init` and `/devices recover` run
 * through a real session — persisted, logged, with turns before and after — the phrase and its
 * passphrase are in no file under HOME or the workspace, no provider request, no history, transcript,
 * session record, emitted event or command result. The only place they were ever written is the
 * secret terminal itself.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDevicesCommandModule } from '@robota-sdk/agent-command';
import { scriptedSession, type ScriptedSessionHarness } from '@robota-sdk/agent-framework/testing';

import { createFileCredentialStore } from '../../credentials/file-credential-store.js';
import { createDevicesCommandPort } from '../index.js';
import { scriptedOperator, type IScriptedOperator } from './fake-secret-terminal.js';
import { filesUnder, leakedIn, phraseFragments } from './secret-leak.js';

import type { ICommandResult } from '@robota-sdk/agent-interface-command';

const PASSPHRASE = 'amber quarry seventeen';

let home: string;
let previousHome: string | undefined;
let session: ScriptedSessionHarness | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'robota-devices-home-'));
  previousHome = process.env.HOME;
  process.env.HOME = home;
});

afterEach(async () => {
  await session?.dispose();
  session = undefined;
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe('the recovery phrase never leaves the secret terminal', () => {
  it('after init and recover, it is in no file, request, history, transcript, event or result', async () => {
    const root = join(home, '.robota');
    let operator: IScriptedOperator = scriptedOperator({ passphrase: PASSPHRASE });
    const port = createDevicesCommandPort({
      // The real keychain is never touched from a test.
      credentials: {
        store: createFileCredentialStore(join(root, 'credentials'), { withinRoot: root }),
        describe: () => 'owner-only file (test)',
      },
      openTerminal: () => operator.session,
    });
    session = scriptedSession({
      turns: [{ text: 'first answer' }, { text: 'second answer' }],
      persistence: true,
      terminalHandoff: { canHandoffTerminal: true, runWithTerminal: (work) => work() },
      commandModules: [createDevicesCommandModule(port)],
    });

    const results: Array<ICommandResult | null> = [];
    results.push(await session.command('devices', 'init laptop'));
    const initOperator = operator;
    const words = initOperator.shownWords();
    expect(words).toHaveLength(24);
    await session.submit('hello after init');
    results.push(await session.command('devices', ''));

    operator = scriptedOperator({ phrase: () => words, passphrase: PASSPHRASE });
    results.push(await session.command('devices', 'recover'));
    await session.submit('hello after recover');
    results.push(await session.command('devices', 'list'));

    expect(results.map((r) => r?.success)).toEqual([true, true, true, true]);
    expect(session.requests.length).toBe(2);

    const fragments = phraseFragments(words, PASSPHRASE);
    // Sanity: the check sees the phrase where it legitimately was — shown once on the secret terminal
    // at init. At recover it was typed there with no echo, so that terminal never shows it.
    expect(leakedIn(initOperator.everything(), fragments).length).toBeGreaterThan(0);
    expect(leakedIn(operator.everything(), fragments)).toEqual([]);

    const places: Array<[string, string]> = [
      ['provider requests', JSON.stringify(session.requests)],
      ['history', JSON.stringify(session.history())],
      ['full history', JSON.stringify(session.sessionLog())],
      ['session record', JSON.stringify(session.sessionRecord() ?? null)],
      ['transcript', session.transcript()],
      ['command results', JSON.stringify(results)],
      ['events', JSON.stringify(session.emittedEvents('user_message'))],
      ...filesUnder(home).map((f): [string, string] => [f.path, f.text]),
      ...filesUnder(session.cwd).map((f): [string, string] => [f.path, f.text]),
    ];
    for (const [where, text] of places) {
      expect({ where, leaked: leakedIn(text, fragments) }).toEqual({ where, leaked: [] });
    }
  });
});
