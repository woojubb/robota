import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import { HttpPromptApiClient } from '../adapters/http-prompt-api-client.js';
import type { IPromptApiClientPort } from '../interfaces/prompt-api-client-port.js';
import type { IPromptRequest } from '@robota-sdk/dag-core';

/**
 * Backend Interchangeability Contract Tests
 *
 * Proves that the IPromptApiClientPort contract works identically
 * against either a Robota DAG API server or a ComfyUI server.
 *
 * Both backends are simulated here with Express mock servers that
 * return the same shapes. In integration testing, these would point
 * to real servers.
 */

const SAMPLE_PROMPT: IPromptRequest = {
    prompt: {
        '1': { class_type: 'LoadImage', inputs: { image: 'test.png' } },
        '2': { class_type: 'PreviewImage', inputs: { images: ['1', 0] } },
    },
};

/**
 * Creates a mock Prompt API server matching the shared contract.
 * Both ComfyUI and Robota return these same JSON shapes.
 */
function createMockPromptServer(label: string): express.Express {
    const app = express();
    app.use(express.json());

    app.post('/prompt', (req, res) => {
        const prompt = req.body?.prompt;
        if (!prompt || Object.keys(prompt).length === 0) {
            res.status(400).json({
                error: { type: 'EMPTY_PROMPT', message: 'Prompt is empty' },
                node_errors: {},
            });
            return;
        }
        res.json({
            prompt_id: `${label}-prompt-001`,
            number: 1,
            node_errors: {},
        });
    });

    app.get('/queue', (_req, res) => {
        res.json({
            queue_running: [],
            queue_pending: [],
        });
    });

    app.post('/queue', (_req, res) => {
        res.json({});
    });

    app.get('/history', (_req, res) => {
        res.json({});
    });

    app.get('/history/:prompt_id', (req, res) => {
        res.json({
            [req.params.prompt_id]: {
                prompt: {},
                outputs: {},
                status: { status_str: 'success', completed: true, messages: [] },
            },
        });
    });

    app.get('/object_info', (_req, res) => {
        res.json({
            LoadImage: {
                display_name: 'Load Image',
                category: 'image',
                input: { required: { image: ['STRING'] } },
                output: ['IMAGE'],
                output_is_list: [false],
                output_name: ['IMAGE'],
                output_node: false,
                description: 'Loads an image',
            },
        });
    });

    app.get('/object_info/:node_type', (req, res) => {
        res.json({
            display_name: req.params.node_type,
            category: 'unknown',
            input: { required: {} },
            output: [],
            output_is_list: [],
            output_name: [],
            output_node: false,
            description: '',
        });
    });

    app.get('/system_stats', (_req, res) => {
        res.json({
            system: {
                os: 'linux',
                runtime_version: `${label}-1.0.0`,
                embedded_python: label === 'comfyui',
            },
            devices: [{ name: 'cpu', type: 'cpu', vram_total: 0, vram_free: 0 }],
        });
    });

    return app;
}

function startServer(app: express.Express): Promise<{ server: http.Server; port: number }> {
    return new Promise((resolve) => {
        const server = http.createServer(app);
        server.listen(0, () => {
            const addr = server.address();
            if (addr && typeof addr !== 'string') {
                resolve({ server, port: addr.port });
            }
        });
    });
}

/**
 * Runs the full IPromptApiClientPort contract suite against a client instance.
 * The same suite is used for both backends.
 */
function runPromptApiContractSuite(getClient: () => IPromptApiClientPort): void {
    it('submitPrompt returns prompt_id and number', async () => {
        const result = await getClient().submitPrompt(SAMPLE_PROMPT);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.prompt_id).toBeDefined();
            expect(typeof result.value.prompt_id).toBe('string');
            expect(typeof result.value.number).toBe('number');
            expect(result.value.node_errors).toBeDefined();
        }
    });

    it('submitPrompt rejects empty prompt', async () => {
        const result = await getClient().submitPrompt({ prompt: {} });
        expect(result.ok).toBe(false);
    });

    it('getQueue returns queue_running and queue_pending', async () => {
        const result = await getClient().getQueue();
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(Array.isArray(result.value.queue_running)).toBe(true);
            expect(Array.isArray(result.value.queue_pending)).toBe(true);
        }
    });

    it('manageQueue succeeds', async () => {
        const result = await getClient().manageQueue({ clear: true });
        expect(result.ok).toBe(true);
    });

    it('getHistory returns object', async () => {
        const result = await getClient().getHistory();
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(typeof result.value).toBe('object');
        }
    });

    it('getHistory with promptId returns entry', async () => {
        const result = await getClient().getHistory('some-prompt-id');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value['some-prompt-id']).toBeDefined();
        }
    });

    it('getObjectInfo returns node type definitions', async () => {
        const result = await getClient().getObjectInfo();
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(typeof result.value).toBe('object');
            const firstNodeType = Object.values(result.value)[0];
            if (firstNodeType) {
                expect(firstNodeType.display_name).toBeDefined();
                expect(firstNodeType.category).toBeDefined();
                expect(firstNodeType.input).toBeDefined();
                expect(Array.isArray(firstNodeType.output)).toBe(true);
            }
        }
    });

    it('getSystemStats returns system and devices', async () => {
        const result = await getClient().getSystemStats();
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.system.os).toBeDefined();
            expect(result.value.system.runtime_version).toBeDefined();
            expect(Array.isArray(result.value.devices)).toBe(true);
        }
    });
}

describe('backend interchangeability contract', () => {
    let robota: { server: http.Server; port: number };
    let comfyui: { server: http.Server; port: number };
    let robotaClient: IPromptApiClientPort;
    let comfyuiClient: IPromptApiClientPort;

    beforeAll(async () => {
        robota = await startServer(createMockPromptServer('robota'));
        comfyui = await startServer(createMockPromptServer('comfyui'));
        robotaClient = new HttpPromptApiClient(`http://localhost:${robota.port}`);
        comfyuiClient = new HttpPromptApiClient(`http://localhost:${comfyui.port}`);
    });

    afterAll(() => {
        robota.server.close();
        comfyui.server.close();
    });

    describe('Robota DAG API Server backend', () => {
        runPromptApiContractSuite(() => robotaClient);
    });

    describe('ComfyUI Server backend', () => {
        runPromptApiContractSuite(() => comfyuiClient);
    });

    describe('cross-backend response shape parity', () => {
        it('submitPrompt response has identical shape from both backends', async () => {
            const robotaResult = await robotaClient.submitPrompt(SAMPLE_PROMPT);
            const comfyuiResult = await comfyuiClient.submitPrompt(SAMPLE_PROMPT);

            expect(robotaResult.ok).toBe(true);
            expect(comfyuiResult.ok).toBe(true);

            if (robotaResult.ok && comfyuiResult.ok) {
                expect(Object.keys(robotaResult.value).sort()).toEqual(
                    Object.keys(comfyuiResult.value).sort()
                );
            }
        });

        it('getQueue response has identical shape from both backends', async () => {
            const robotaResult = await robotaClient.getQueue();
            const comfyuiResult = await comfyuiClient.getQueue();

            expect(robotaResult.ok).toBe(true);
            expect(comfyuiResult.ok).toBe(true);

            if (robotaResult.ok && comfyuiResult.ok) {
                expect(Object.keys(robotaResult.value).sort()).toEqual(
                    Object.keys(comfyuiResult.value).sort()
                );
            }
        });

        it('getSystemStats response has identical shape from both backends', async () => {
            const robotaResult = await robotaClient.getSystemStats();
            const comfyuiResult = await comfyuiClient.getSystemStats();

            expect(robotaResult.ok).toBe(true);
            expect(comfyuiResult.ok).toBe(true);

            if (robotaResult.ok && comfyuiResult.ok) {
                expect(Object.keys(robotaResult.value).sort()).toEqual(
                    Object.keys(comfyuiResult.value).sort()
                );
                expect(Object.keys(robotaResult.value.system).sort()).toEqual(
                    Object.keys(comfyuiResult.value.system).sort()
                );
            }
        });
    });

    describe('orchestrator works with either backend', () => {
        it('can switch backend by changing only the client instance', async () => {
            // Same operation, different backends — both succeed
            for (const client of [robotaClient, comfyuiClient]) {
                const submit = await client.submitPrompt(SAMPLE_PROMPT);
                expect(submit.ok).toBe(true);

                const queue = await client.getQueue();
                expect(queue.ok).toBe(true);

                const stats = await client.getSystemStats();
                expect(stats.ok).toBe(true);
            }
        });
    });
});
