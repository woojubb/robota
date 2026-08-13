import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDagFramework } from '../create-dag-framework.js';

import type { IDagFramework } from '../types.js';
import type { IDagNodeDefinition } from '@robota-sdk/dag-core';

const PROMPT_COUNT = 12;

async function bounded<T>(work: Promise<T>, timeoutMs = 10_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`work exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

describe('RUNTIME-003 queue-scoped advancement ownership', () => {
  let framework: IDagFramework | undefined;
  let root: string | undefined;

  afterEach(async () => {
    if (framework !== undefined) await bounded(framework.stop());
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('runs at most one node at a time when concurrent prompts share one queue', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'runtime-003-contention-'));
    let active = 0;
    let maximumActive = 0;
    let executions = 0;

    const slowNode: IDagNodeDefinition = {
      nodeType: 'test/slow',
      displayName: 'Slow',
      category: 'test',
      inputs: [],
      outputs: [{ key: 'text', type: 'string', required: true }],
      configSchemaDefinition: null,
      defaultOutputPort: 'text',
      taskHandler: {
        async execute() {
          executions += 1;
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          try {
            await new Promise<void>((resolve) => setTimeout(resolve, 30));
            return { ok: true, value: { text: 'ok' } };
          } finally {
            active -= 1;
          }
        },
      },
    };

    framework = await createDagFramework({
      executionRoot: root,
      nodes: [slowNode],
      paths: { storageRoot: path.join(root, 'storage'), assetRoot: path.join(root, 'assets') },
      autoStart: true,
    });

    const results = await bounded(
      Promise.all(
        Array.from({ length: PROMPT_COUNT }, (_, index) =>
          framework?.internals.promptBackend.submitPrompt({
            prompt_id: `contention-${index}`,
            prompt: { '1': { class_type: 'test/slow', inputs: {} } },
          }),
        ),
      ),
    );
    expect(results.every((result) => result?.ok === true)).toBe(true);

    await bounded(
      (async () => {
        while (executions < PROMPT_COUNT) {
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
        while (active > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
      })(),
    );

    expect(executions).toBe(PROMPT_COUNT);
    expect(maximumActive).toBe(1);
  });
});
