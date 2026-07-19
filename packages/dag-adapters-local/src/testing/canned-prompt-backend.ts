import type { IPromptBackendPort } from '@robota-sdk/dag-core';

/**
 * Creates an in-memory {@link IPromptBackendPort} that returns fixed, canned success responses (overridable per
 * method). Useful for testing controllers, routes, and orchestrator services without a real backend.
 * (HARNESS-033: relocated from the package main entry + renamed from `createStubPromptBackend` — it returns
 * real canned data, and the no-fake-in-src rule keeps `Stub*` names to test code; now lives under `./testing`.)
 */
export function createCannedPromptBackend(
  overrides?: Partial<IPromptBackendPort>,
): IPromptBackendPort {
  return {
    submitPrompt: async () => ({
      ok: true as const,
      value: { prompt_id: 'canned-prompt-id', number: 1, node_errors: {} },
    }),
    getQueue: async () => ({
      ok: true as const,
      value: { queue_running: [], queue_pending: [] },
    }),
    manageQueue: async () => ({ ok: true as const, value: undefined }),
    getHistory: async () => ({ ok: true as const, value: {} }),
    getObjectInfo: async () => ({
      ok: true as const,
      value: {
        TestNode: {
          display_name: 'Test Node',
          category: 'test',
          input: { required: {}, optional: {} },
          output: ['STRING'],
          output_is_list: [false],
          output_name: ['output'],
          output_node: false,
          description: '',
        },
      },
    }),
    getSystemStats: async () => ({
      ok: true as const,
      value: {
        system: { os: 'darwin', runtime_version: '', embedded_python: false },
        devices: [],
      },
    }),
    ...overrides,
  };
}
