import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AbstractAIProvider,
  type IChatOptions,
  type TUniversalMessage,
} from '@robota-sdk/agent-core';
import { Session } from '@robota-sdk/agent-session';

class RecordingProvider extends AbstractAIProvider {
  override readonly name = 'recording-provider';
  override readonly version = '1.0.0';
  readonly efforts: string[] = [];

  override async chat(
    _messages: TUniversalMessage[],
    options?: IChatOptions,
  ): Promise<TUniversalMessage> {
    this.efforts.push(options?.effort ?? 'missing');
    return {
      id: `assistant-${this.efforts.length}`,
      role: 'assistant',
      content: 'ok',
      state: 'complete',
      timestamp: new Date(),
    };
  }
}

const terminal = {
  write: () => {},
  writeLine: () => {},
  writeMarkdown: () => {},
  writeError: () => {},
  prompt: async () => '',
  select: async () => 0,
  spinner: () => ({ stop: () => {}, update: () => {} }),
};

async function main(): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), 'robota-behavior-009-'));
  const provider = new RecordingProvider();
  const session = new Session({
    cwd,
    tools: [],
    provider,
    systemMessage: 'behavior-009 verification',
    terminal,
    model: 'recording-model',
    effort: 'low',
  });

  try {
    await session.withScopedModelEffort('high', () => session.run('success'));
    if (provider.efforts.at(-1) !== 'high') {
      throw new Error(
        `Expected the scoped provider request to use high, got ${provider.efforts.at(-1)}`,
      );
    }
    console.log(`success scoped=high restored=${session.getModelEffort()}`);

    let failureScoped = 'missing';
    try {
      await session.withScopedModelEffort('high', async () => {
        failureScoped = session.getModelEffort();
        throw new Error('expected failure');
      });
    } catch {
      // The scenario verifies restoration after rejection below.
    }
    console.log(`failure scoped=${failureScoped} restored=${session.getModelEffort()}`);

    let cancelledScoped = 'missing';
    try {
      await session.withScopedModelEffort('high', async () => {
        cancelledScoped = session.getModelEffort();
        throw new DOMException('cancelled', 'AbortError');
      });
    } catch {
      // The scenario verifies that cancellation follows the same finally path.
    }
    console.log(`cancel scoped=${cancelledScoped} restored=${session.getModelEffort()}`);

    let inner = 'missing';
    let outer = 'missing';
    await session.withScopedModelEffort('medium', async () => {
      outer = session.getModelEffort();
      await session.withScopedModelEffort('high', async () => {
        inner = session.getModelEffort();
      });
    });
    console.log(`nested inner=${inner} outer=${outer} restored=${session.getModelEffort()}`);
  } finally {
    await session.shutdown();
    rmSync(cwd, { recursive: true, force: true });
  }
}

await main();
