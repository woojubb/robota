/**
 * The built-binary driver reads the tool calls a run persisted through the product's own session
 * store, never by parsing the file: a record the product seals reads back exactly as the
 * product reads it, and a record that is there and unreadable is an error, not a crash or nothing.
 * The "binary" here is a stand-in that only reports a session id on its stream.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { createProductUserSessionStore } from '../../product/session-stores.js';
import { createBinaryAgentDriver } from '../binary-agent-driver.js';

import type { TArtifactSealing } from '@robota-sdk/agent-core';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface/session';

const sealing = vi.hoisted(() => ({ current: 'plain' as unknown }));

vi.mock('../../product/session-sealing.js', () => ({
  resolveProductSessionSealing: () => sealing.current as TArtifactSealing,
}));

const SESSION_ID = 'sess_driver';
let home: string;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'binary-driver-records-')));
  sealing.current = 'plain';
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** A stand-in for the CLI: it prints its session id and a result on the stream, as print mode does. */
function fakeBinary(): string {
  const bin = join(home, 'fake-bin.mjs');
  writeFileSync(
    bin,
    [
      `process.stdout.write(JSON.stringify({ type: 'system', session_id: ${JSON.stringify(SESSION_ID)} }) + '\\n');`,
      `process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: 'done' }) + '\\n');`,
    ].join('\n'),
  );
  return bin;
}

const at = new Date('2026-09-01T00:00:00.000Z');
const record: IInteractiveSessionRecord = {
  id: SESSION_ID,
  cwd: '/work',
  createdAt: at.toISOString(),
  updatedAt: at.toISOString(),
  messages: [
    { id: 'm-0', role: 'user', content: 'read it', timestamp: at, state: 'complete' },
    {
      id: 'm-1',
      role: 'assistant',
      content: null,
      timestamp: at,
      state: 'complete',
      toolCalls: [
        { id: 'call_1', type: 'function', function: { name: 'Read', arguments: '{"path":"a"}' } },
      ],
    },
    {
      id: 'm-2',
      role: 'tool',
      content: 'contents of a',
      timestamp: at,
      state: 'complete',
      toolCallId: 'call_1',
      name: 'Read',
    },
  ],
};

function driverFor(): ReturnType<typeof createBinaryAgentDriver> {
  return createBinaryAgentDriver({
    productRuntime: createTestProductRuntime('test-product', { HOME: home }),
    cwd: home,
    binPath: fakeBinary(),
    env: { HOME: home },
  });
}

describe("the binary driver reads the run's record through the product store", () => {
  it('reads the tool calls of a record the product sealed', async () => {
    sealing.current = { sealer: createTestArtifactSealer() };
    createProductUserSessionStore(createTestProductRuntime('test-product', { HOME: home })).save(
      record,
    );
    const driver = driverFor();

    await driver.send('read it');

    expect(driver.toolCalls()).toEqual([
      expect.objectContaining({ id: 'call_1', name: 'Read', args: { path: 'a' } }),
    ]);
    expect(driver.errors()).toEqual([]);
  });

  it('reports a record that is there and unreadable as an error', async () => {
    const sessions = createTestProductRuntime('test-product', { HOME: home }).layout.userPaths
      .sessions;
    createProductUserSessionStore(createTestProductRuntime('test-product', { HOME: home })).save(
      record,
    );
    writeFileSync(join(sessions, `${SESSION_ID}.json`), '{ cut short', 'utf8');
    const driver = driverFor();

    await driver.send('read it');

    expect(driver.toolCalls()).toEqual([]);
    expect(driver.errors().map((error) => error.message)).toEqual([
      "The run's session record could not be read (corrupt).",
    ]);
  });
});
