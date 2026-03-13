import type { IPromptBackendPort } from '../interfaces/prompt-backend-port.js';

/**
 * Creates an in-memory stub implementing IPromptBackendPort.
 * Useful for testing controllers, routes, and orchestrator services.
 */
export function createStubPromptBackend(
    overrides?: Partial<IPromptBackendPort>,
): IPromptBackendPort {
    return {
        submitPrompt: async () => ({
            ok: true as const,
            value: { prompt_id: 'stub-prompt-id', number: 1, node_errors: {} },
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
