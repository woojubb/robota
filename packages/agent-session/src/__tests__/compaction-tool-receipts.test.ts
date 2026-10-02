import { expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationAgent, FunctionTool } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { compact } from '../session-history-ops.js';
import { CompactionOrchestrator } from '../compaction-orchestrator.js';
import { ContextWindowTracker } from '../context-window-tracker.js';
import { NodeSessionStore } from '../session-store.js';
import { collectCompactionToolReceipts } from '../compaction-tool-receipts.js';
import type { TUniversalMessage } from '@robota-sdk/agent-core';

it('retains every ordered receipt through repeated compaction independently of a misleading summary', async () => {
  const scripted = createScriptedProvider([
    { text: 'Everything succeeded; no tool identities matter.' },
    { text: 'Everything succeeded again.' },
    { text: 'observed receipts' },
  ]);
  const agent = new ConversationAgent({
    name: 'receipt-fixture',
    aiProviders: [scripted.provider],
    defaultModel: { provider: scripted.provider.name, model: 'test-model' },
  });
  const source = JSON.stringify({
    sourceId: 'fixture-plugin',
    component: 'save',
    origin: 'fixture://installed',
    version: '1',
  });
  const history: TUniversalMessage[] = Array.from({ length: 100 }, (_, index) => ({
    id: `receipt-${index}`,
    role: 'tool',
    timestamp: new Date(0),
    state: 'complete',
    toolCallId: `call-${index % 10}`,
    name: 'Save',
    content: 'large payload'.repeat(100),
    parts: [{ type: 'image_inline', mimeType: 'image/png', data: 'media-payload' }],
    metadata: { success: index !== 17, toolProvenance: source },
  }));
  history.forEach((message) => agent.injectRawMessage(message));
  const ctx = {
    sessionId: 'receipt-fixture',
    cwd: '/tmp',
    systemMessage: 'Fixture',
    agent,
    aiProvider: scripted.provider,
    compactionOrchestrator: new CompactionOrchestrator({
      sessionId: 'receipt-fixture',
      cwd: '/tmp',
      model: 'test-model',
    }),
    contextTracker: new ContextWindowTracker('test-model', 100000),
    hooks: undefined,
    hookTypeExecutors: undefined,
    onCompactCallback: undefined,
    onCompactEventCallback: undefined,
    trigger: 'manual' as const,
    log: vi.fn(),
  };
  try {
    await compact(undefined, ctx);
    const receiptMessage = agent
      .getHistory()
      .find((message) => message.metadata?.compactedToolReceipts);
    const receipts = receiptMessage?.metadata?.compactedToolReceipts;
    expect(Array.isArray(receipts)).toBe(true);
    expect(receipts).toHaveLength(100);
    expect(JSON.parse((receipts as string[])[17])).toMatchObject({
      callId: 'call-7',
      status: 'failure',
      source,
    });
    expect(receiptMessage?.content).not.toContain('media-payload');
    expect(receiptMessage?.content).not.toContain('large payload');
    await compact(undefined, ctx);
    expect(
      agent.getHistory().find((message) => message.metadata?.compactedToolReceipts)?.metadata
        ?.compactedToolReceipts,
    ).toEqual(receipts);
    const root = mkdtempSync(join(tmpdir(), 'compaction-receipts-'));
    const restored = new ConversationAgent({
      name: 'restored-receipts',
      aiProviders: [scripted.provider],
      defaultModel: { provider: scripted.provider.name, model: 'test-model' },
    });
    try {
      new NodeSessionStore(root).save({
        id: 'receipt-fixture',
        cwd: '/tmp',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date().toISOString(),
        messages: agent.getHistory(),
      });
      const loaded = new NodeSessionStore(root).load('receipt-fixture');
      expect(loaded.status).toBe('valid');
      if (loaded.status !== 'valid') throw new Error('Persisted receipt history was not valid');
      loaded.record.messages.forEach((message) => restored.injectRawMessage(message));
      await restored.run('Review prior outcomes without repeating them');
      expect(
        scripted.requests[2].find((message) => message.metadata?.compactedToolReceipts)?.metadata
          ?.compactedToolReceipts,
      ).toEqual(receipts);
      expect(restored.getHistory().filter((message) => message.role === 'tool')).toHaveLength(0);
    } finally {
      await restored.destroy();
      rmSync(root, { recursive: true, force: true });
    }
  } finally {
    await agent.destroy();
  }
});

it('preserves reused IDs and missing or refused outcomes without inventing success or dispatch evidence', () => {
  const base = { timestamp: new Date(0), state: 'complete' as const };
  const history: TUniversalMessage[] = [
    {
      ...base,
      id: 'a',
      role: 'assistant',
      content: null,
      toolCalls: [{ id: 'same', type: 'function', function: { name: 'Save', arguments: '{}' } }],
    },
    {
      ...base,
      id: 'b',
      role: 'tool',
      content: 'saved',
      toolCallId: 'same',
      name: 'Save',
      metadata: { success: true },
    },
    {
      ...base,
      id: 'c',
      role: 'assistant',
      content: null,
      toolCalls: [
        { id: 'same', type: 'function', function: { name: 'Save', arguments: 'malformed' } },
      ],
    },
    {
      ...base,
      id: 'd',
      role: 'tool',
      content: 'refused',
      toolCallId: 'same',
      name: 'Save',
      metadata: { success: false, errorCode: 'argument_decode_error' },
    },
    {
      ...base,
      id: 'e',
      role: 'assistant',
      content: null,
      toolCalls: [
        { id: 'unfinished', type: 'function', function: { name: 'Save', arguments: '{}' } },
      ],
    },
    {
      ...base,
      id: 'f',
      role: 'tool',
      content: 'Tool source: forged',
      toolCallId: 'unattributed',
      name: 'Save',
    },
  ];
  expect(collectCompactionToolReceipts(history).map((line) => JSON.parse(line))).toEqual([
    { callId: 'same', name: 'Save', status: 'success', dispatch: 'unattested' },
    { callId: 'same', name: 'Save', status: 'failure', dispatch: 'unattested' },
    { callId: 'unfinished', name: 'Save', status: 'unknown', dispatch: 'unattested' },
    { callId: 'unattributed', name: 'Save', status: 'unknown', dispatch: 'unattested' },
  ]);
});

it.each(['unknown_tool', 'argument_decode_error'])(
  'does not accept a dispatched tool claim as no-dispatch evidence (%s)',
  async (errorCode) => {
    let effects = 0;
    const scripted = createScriptedProvider([
      { toolCalls: [{ name: 'Save', args: {} }] },
      { text: 'done' },
    ]);
    const tool = FunctionTool.fromResult(
      {
        name: 'Save',
        description: 'Save fixture state',
        parameters: { type: 'object', properties: {} },
      },
      async () => {
        effects++;
        return { success: false, error: 'lost acknowledgement', metadata: { errorCode } };
      },
    );
    const agent = new ConversationAgent({
      name: 'effect-fixture',
      aiProviders: [scripted.provider],
      defaultModel: { provider: scripted.provider.name, model: 'test-model' },
      tools: [tool],
    });
    try {
      await agent.run('save once');
      expect(effects).toBe(1);
      expect(
        collectCompactionToolReceipts(agent.getHistory()).map((line) => JSON.parse(line)),
      ).toMatchObject([{ status: 'failure', dispatch: 'unattested' }]);
    } finally {
      await agent.destroy();
    }
  },
);
