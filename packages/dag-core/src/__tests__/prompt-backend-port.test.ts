import { describe, it, expect } from 'vitest';
import type { IPromptBackendPort } from '../interfaces/prompt-backend-port.js';

describe('IPromptBackendPort', () => {
  it('should be implementable as an in-memory stub', async () => {
    const stub: IPromptBackendPort = {
      submitPrompt: async () => ({
        ok: true as const,
        value: { prompt_id: 'test-id', number: 1, node_errors: {} },
      }),
      getQueue: async () => ({
        ok: true as const,
        value: { queue_running: [], queue_pending: [] },
      }),
      manageQueue: async () => ({ ok: true as const, value: undefined }),
      getHistory: async () => ({ ok: true as const, value: {} }),
      getObjectInfo: async () => ({ ok: true as const, value: {} }),
      getSystemStats: async () => ({
        ok: true as const,
        value: {
          system: { os: 'darwin', runtime_version: '', embedded_python: false },
          devices: [],
        },
      }),
    };

    const result = await stub.submitPrompt({
      prompt: { '1': { class_type: 'Test', inputs: {} } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.prompt_id).toBe('test-id');
    }
  });
});
