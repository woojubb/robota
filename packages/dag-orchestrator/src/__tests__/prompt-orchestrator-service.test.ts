import { describe, it, expect, beforeEach } from 'vitest';
import { PromptOrchestratorService } from '../services/prompt-orchestrator-service.js';
import type { IPromptApiClientPort } from '../interfaces/prompt-api-client-port.js';
import type { ICostEstimatorPort, ICostPolicyEvaluatorPort } from '../interfaces/orchestrator-policy-port.js';

function createStubApiClient(): IPromptApiClientPort {
    return {
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
        getObjectInfo: async () => ({
            ok: true as const,
            value: {
                TestNode: {
                    display_name: 'Test',
                    category: 'test',
                    input: { required: {} },
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
    };
}

function createStubCostEstimator(): ICostEstimatorPort {
    return {
        estimateCost: async () => ({
            ok: true as const,
            value: {
                totalEstimatedCredits: 0.05,
                perNode: { '1': { nodeType: 'TestNode', estimatedCredits: 0.05 } },
            },
        }),
    };
}

function createStubPolicyEvaluator(): ICostPolicyEvaluatorPort {
    return { evaluate: () => ({ ok: true as const, value: undefined }) };
}

describe('PromptOrchestratorService', () => {
    let service: PromptOrchestratorService;
    let apiClient: IPromptApiClientPort;

    beforeEach(() => {
        apiClient = createStubApiClient();
        service = new PromptOrchestratorService(
            apiClient,
            createStubCostEstimator(),
            createStubPolicyEvaluator(),
        );
    });

    it('should submit prompt without cost policy', async () => {
        const result = await service.submitPrompt({
            promptRequest: {
                prompt: { '1': { class_type: 'TestNode', inputs: {} } },
            },
        });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.promptResponse.prompt_id).toBe('test-id');
    });

    it('should estimate cost and enforce policy when configured', async () => {
        const result = await service.submitPrompt({
            promptRequest: {
                prompt: { '1': { class_type: 'TestNode', inputs: {} } },
            },
            config: { costPolicy: { maxCreditsPerPrompt: 1.0 } },
        });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.costEstimate?.totalEstimatedCredits).toBe(0.05);
    });

    it('should reject prompt when cost exceeds policy', async () => {
        const rejectingEvaluator: ICostPolicyEvaluatorPort = {
            evaluate: () => ({
                ok: false as const,
                error: {
                    code: 'COST_LIMIT_EXCEEDED',
                    category: 'validation' as const,
                    message: 'Exceeds limit',
                    retryable: false,
                },
            }),
        };
        service = new PromptOrchestratorService(
            apiClient,
            createStubCostEstimator(),
            rejectingEvaluator,
        );

        const result = await service.submitPrompt({
            promptRequest: {
                prompt: { '1': { class_type: 'TestNode', inputs: {} } },
            },
            config: { costPolicy: { maxCreditsPerPrompt: 0.01 } },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('COST_LIMIT_EXCEEDED');
    });

    it('should delegate getQueue to API client', async () => {
        expect((await service.getQueue()).ok).toBe(true);
    });

    it('should delegate getHistory to API client', async () => {
        expect((await service.getHistory()).ok).toBe(true);
    });

    it('should delegate getSystemStats to API client', async () => {
        expect((await service.getSystemStats()).ok).toBe(true);
    });
});
