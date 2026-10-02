import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createNodeHostSessionStore } from '@robota-sdk/agent-framework';
import { buildCatalog, createDiscoveredTool } from '@robota-sdk/agent-mcp';
import {
  assertBrowserReconciled,
  type IBrowserReconciliationObservation,
} from './outcome-browser-reconciliation.js';

const reconciled: IBrowserReconciliationObservation = {
  interrupted: true,
  resumedInterrupted: false,
  cancellationPropagated: true,
  restoredOutcome: true,
  sameSessionId: true,
  before: { theme: 'dark', writes: 1 },
  after: { theme: 'dark', writes: 1 },
  resumedCalls: ['browser_snapshot'],
};

test('lost browser observation requires current state and no duplicate effect', () => {
  assert.doesNotThrow(() => assertBrowserReconciled(reconciled));
  for (const bad of [
    { ...reconciled, interrupted: false },
    { ...reconciled, resumedInterrupted: true },
    { ...reconciled, cancellationPropagated: false },
    { ...reconciled, restoredOutcome: false },
    { ...reconciled, sameSessionId: false },
    { ...reconciled, before: undefined },
    { ...reconciled, before: { theme: 'light', writes: 0 } },
    { ...reconciled, after: { theme: 'dark', writes: 2 } },
    { ...reconciled, after: { theme: 'light', writes: 1 } },
    { ...reconciled, resumedCalls: [] },
    { ...reconciled, resumedCalls: ['browser_click', 'browser_snapshot'] },
  ])
    assert.throws(() => assertBrowserReconciled(bad), /Browser reconciliation failed/);
});

test('foreign dialect metadata is adapted before a tool schema crosses the session store', () => {
  const root = mkdtempSync(join(tmpdir(), 'browser-schema-roundtrip-'));
  try {
    const foreign = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        target: { $schema: 'foreign', type: 'string' },
        fields: { type: 'array', items: { $schema: 'foreign', type: 'string' } },
        mode: { anyOf: [{ $schema: 'foreign', type: 'string' }, { type: 'null' }] },
      },
      additionalProperties: { $schema: 'foreign', type: 'string' },
    } as never;
    const catalog = buildCatalog([
      {
        serverId: 'browser',
        origin: 'fixture',
        transport: 'stdio',
        discovery: {
          identity: {
            serverId: 'browser',
            serverName: 'fixture',
            serverVersion: '1',
            protocolVersion: '2025-11-25',
          },
          tools: {
            state: { kind: 'supported', count: 1, listChanged: false },
            items: [{ name: 'observe', inputSchema: foreign }],
            pages: 1,
          },
          prompts: { state: { kind: 'unsupported' }, items: [], pages: 0 },
          resources: { state: { kind: 'unsupported' }, items: [], pages: 0 },
        },
      },
    ]);
    const entry = catalog.adapted.find((entry) => entry.kind === 'tool');
    assert.ok(entry?.kind === 'tool');
    const tool = createDiscoveredTool(entry, {
      callTool: async () => ({ content: [], isError: false }),
    });
    const store = createNodeHostSessionStore(root);
    const record = {
      id: 'browser-session',
      cwd: root,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      systemPrompt: 'fixture',
      messages: [],
      history: [],
      toolSchemas: [tool.schema],
    };
    store.save(record);
    const loaded = createNodeHostSessionStore(root).load(record.id);
    assert.equal(loaded.status, 'valid');
    if (loaded.status === 'valid') assert.deepEqual(loaded.record.toolSchemas, [tool.schema]);
    // The codec remains strict: bypassing adaptation must still reject the foreign declaration.
    store.save({ ...record, toolSchemas: [{ ...tool.schema, parameters: foreign }] });
    assert.equal(store.load(record.id).status, 'corrupt');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
