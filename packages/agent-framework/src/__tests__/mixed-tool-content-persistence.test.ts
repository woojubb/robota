import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ConversationAgent, type TUniversalMessagePart } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { NodeSessionStore } from '@robota-sdk/agent-session';

it('restores runtime mixed tool history through the real session file codec', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mixed-observation-session-'));
  const counter = join(root, 'effects');
  writeFileSync(counter, '0');
  const parts: TUniversalMessagePart[] = [
    { type: 'text', text: 'Persisted screenshot description' },
    { type: 'image_inline', mimeType: 'image/png', data: 'iVBORw0KGgo=' },
  ];
  const scripted = createScriptedProvider([
    { toolCalls: [{ name: 'observe', args: {} }] },
    { text: 'done' },
  ]);
  const restored = createScriptedProvider([{ text: 'remembered' }]);
  const tool = {
    schema: {
      name: 'observe',
      description: 'Observe fixture',
      parameters: { type: 'object' as const, properties: {} },
    },
    getName: () => 'observe',
    getDescription: () => 'Observe fixture',
    validate: () => true,
    validateParameters: () => ({ isValid: true, errors: [] }),
    setEventService: () => {},
    execute: async () => {
      writeFileSync(counter, String(Number(readFileSync(counter, 'utf8')) + 1));
      return { success: true, data: { revision: 'snapshot-1' }, parts };
    },
  };
  const first = new ConversationAgent({
    name: 'mixed-session',
    aiProviders: [scripted.provider],
    defaultModel: { provider: scripted.provider.name, model: 'fixture' },
    tools: [tool],
  });
  const fresh = new ConversationAgent({
    name: 'mixed-session',
    aiProviders: [restored.provider],
    defaultModel: { provider: restored.provider.name, model: 'fixture' },
    tools: [tool],
  });
  try {
    await first.run('observe');
    const store = new NodeSessionStore(join(root, 'sessions'));
    store.save({
      id: 'mixed-session',
      cwd: root,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      messages: first.getHistory(),
    });
    await first.destroy();
    const loaded = new NodeSessionStore(join(root, 'sessions')).load('mixed-session');
    expect(loaded.status).toBe('valid');
    if (loaded.status !== 'valid') throw new Error('Session codec rejected mixed observations');
    expect(loaded.record.messages.find((message) => message.role === 'tool')).toMatchObject({
      content: '{"revision":"snapshot-1"}',
      parts,
    });
    for (const message of loaded.record.messages) fresh.injectRawMessage(message);
    await fresh.run('Recall the saved observation');
    expect(restored.requests[0].find((message) => message.role === 'tool')).toMatchObject({
      content: '{"revision":"snapshot-1"}',
      parts,
    });
    expect(readFileSync(counter, 'utf8')).toBe('1');
  } finally {
    await first.destroy();
    await fresh.destroy();
    rmSync(root, { recursive: true, force: true });
  }
});
