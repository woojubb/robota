import { describe, it, expect, beforeEach } from 'vitest';
import { PromptApiController } from '../controllers/prompt-api-controller.js';
import type { IPromptBackendPort } from '@robota-sdk/dag-core';

function createStubBackend(): IPromptBackendPort {
  return {
    submitPrompt: async () => ({
      ok: true as const,
      value: { prompt_id: 'stub-id', number: 1, node_errors: {} },
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
}

describe('PromptApiController', () => {
  let controller: PromptApiController;

  beforeEach(() => {
    controller = new PromptApiController(createStubBackend());
  });

  describe('submitPrompt', () => {
    it('should return prompt_id on valid prompt', async () => {
      const result = await controller.submitPrompt({
        prompt: { '1': { class_type: 'Test', inputs: { value: 'hello' } } },
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.prompt_id).toBe('stub-id');
    });

    it('should reject empty prompt', async () => {
      const result = await controller.submitPrompt({ prompt: {} });
      expect(result.ok).toBe(false);
    });
  });

  describe('delegated operations', () => {
    it('getQueue should return queue status', async () => {
      expect((await controller.getQueue()).ok).toBe(true);
    });
    it('manageQueue should accept clear action', async () => {
      expect((await controller.manageQueue({ clear: true })).ok).toBe(true);
    });
    it('getHistory should return history', async () => {
      expect((await controller.getHistory()).ok).toBe(true);
    });
    it('getObjectInfo should return node types', async () => {
      expect((await controller.getObjectInfo()).ok).toBe(true);
    });
    it('getSystemStats should return stats', async () => {
      expect((await controller.getSystemStats()).ok).toBe(true);
    });
  });
});
