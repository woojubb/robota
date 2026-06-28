/**
 * INFRA-019: in-process programmatic driving of the REAL agent.
 *
 * Drives `createProgrammaticAgent` (→ `createInteractiveRuntime` → a real `InteractiveSession`) with
 * the deterministic scripted provider. No terminal, no PTY, no mocks of the framework loop: a message
 * is pushed in-process and the structured `InteractionEvent` stream is asserted as data. This is the
 * in-process form of "drive the agent at will" (TEST-008 north star).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createProgrammaticAgent,
  ProgrammaticInteractionChannel,
  type IProgrammaticAgent,
} from '../../programmatic/index.js';

describe('programmatic in-process agent driver (INFRA-019)', () => {
  let cwd: string;
  let driver: IProgrammaticAgent | undefined;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-programmatic-'));
  });

  afterEach(async () => {
    await driver?.stop();
    driver = undefined;
    rmSync(cwd, { recursive: true, force: true });
  });

  it('TC-01/02: send() drives a real turn and the scripted assistant reply is captured as data', async () => {
    const scripted = createScriptedProvider([{ text: 'DRIVEN_ANSWER_42' }]);
    driver = createProgrammaticAgent({ provider: scripted.provider, cwd });

    await driver.start();
    await driver.send('hello');

    // TC-02: the reply is captured structurally — no terminal involved.
    expect(driver.lastAssistantText()).toBe('DRIVEN_ANSWER_42');
    expect(driver.assistantReplies()).toEqual(['DRIVEN_ANSWER_42']);

    // Event order: the user message is recorded before the assistant completion.
    const types = driver.events.map((e) => e.type);
    expect(types).toContain('user-message');
    expect(types).toContain('assistant-done');
    expect(types.indexOf('user-message')).toBeLessThan(types.indexOf('assistant-done'));
    expect(driver.errors()).toEqual([]);

    // The scripted provider saw exactly the driven message.
    const firstRequest = scripted.requests[0] ?? [];
    const contents = firstRequest.map((m) => String(m.content));
    expect(contents.some((c) => c.includes('hello'))).toBe(true);
  });

  it('TC-03: a scripted tool-call turn runs the real tool loop and is captured in toolCalls()', async () => {
    const target = join(cwd, 'greet.txt');
    writeFileSync(target, 'Hello, world\n', 'utf8');

    const scripted = createScriptedProvider([
      {
        toolCalls: [
          { name: 'Edit', args: { filePath: target, oldString: 'Hello', newString: 'Goodbye' } },
        ],
      },
      { text: 'edit done' },
    ]);
    driver = createProgrammaticAgent({
      provider: scripted.provider,
      cwd,
      permissionMode: 'bypassPermissions',
    });

    await driver.start();
    await driver.send('change the greeting');

    // The real tool loop executed: the file on disk was mutated.
    expect(readFileSync(target, 'utf8')).toBe('Goodbye, world\n');
    // The tool call surfaced as structured data.
    const calls = driver.toolCalls();
    expect(calls.some((c) => c.name === 'Edit')).toBe(true);
    expect(driver.lastAssistantText()).toBe('edit done');
  });

  it('TC-04: queueAction pre-answers a requestAction; empty queue resolves to cancelled', async () => {
    const scripted = createScriptedProvider([{ text: 'noop' }]);
    driver = createProgrammaticAgent({ provider: scripted.provider, cwd });
    await driver.start();

    // Exercise the request/response contract in isolation (the framework only calls requestAction
    // for command interaction hints — the same FIFO queue the driver's queueAction feeds).
    const channel = new ProgrammaticInteractionChannel();

    channel.queueAction({ type: 'confirm', confirmed: true });
    const answered = await channel.requestAction({ type: 'confirm', id: 'x', message: 'ok?' });
    expect(answered).toEqual({ type: 'confirm', confirmed: true });

    const defaulted = await channel.requestAction({ type: 'confirm', id: 'y', message: 'ok?' });
    expect(defaulted).toEqual({ type: 'cancelled' });
  });
});
