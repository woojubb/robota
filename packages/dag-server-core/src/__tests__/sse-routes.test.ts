import { describe, expect, it, vi, beforeEach } from 'vitest';
import express, { type Router, type Response } from 'express';
import http from 'node:http';
import { registerSseRoutes } from '../routes/sse-routes.js';
import type { IClockPort } from '@robota-sdk/dag-core';

function createMockRunQuery(): any {
    return {
        getRun: vi.fn()
    };
}

function createMockClock(): IClockPort {
    return {
        nowIso: vi.fn().mockReturnValue('2026-01-01T00:00:00.000Z'),
        nowEpochMs: vi.fn().mockReturnValue(1735689600000)
    };
}

function createTestApp(
    sseClients: Map<string, Set<Response>>,
    runQuery: any,
    clock: IClockPort,
    sseKeepAliveMs: number = 30_000
): Router {
    const app = express();
    app.use(express.json());
    registerSseRoutes(
        app as unknown as Router,
        sseClients,
        runQuery,
        clock,
        sseKeepAliveMs
    );
    return app as unknown as Router;
}

/**
 * Makes an SSE request and collects events until the connection is closed or a timeout.
 */
async function makeSseRequest(
    app: Router,
    path: string,
    timeoutMs: number = 500
): Promise<{ status: number; events: string[] }> {
    return new Promise((resolve, reject) => {
        const server = http.createServer(app as any);
        server.listen(0, () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close();
                reject(new Error('Failed to get server address'));
                return;
            }
            const port = address.port;
            const events: string[] = [];
            const req = http.request({
                method: 'GET',
                hostname: 'localhost',
                port,
                path
            }, (res) => {
                res.on('data', (chunk: Buffer) => {
                    events.push(chunk.toString());
                });
                const timer = setTimeout(() => {
                    req.destroy();
                    server.close();
                    resolve({ status: res.statusCode ?? 0, events });
                }, timeoutMs);
                res.on('end', () => {
                    clearTimeout(timer);
                    server.close();
                    resolve({ status: res.statusCode ?? 0, events });
                });
            });
            req.on('error', () => {
                server.close();
                resolve({ status: 0, events });
            });
            req.end();
        });
    });
}

describe('sse-routes', () => {
    let runQuery: any;
    let clock: IClockPort;
    let sseClients: Map<string, Set<Response>>;

    beforeEach(() => {
        runQuery = createMockRunQuery();
        clock = createMockClock();
        sseClients = new Map();
    });

    describe('GET /v1/dag/runs/:dagRunId/events', () => {
        it('streams SSE events for a queued/running run', async () => {
            runQuery.getRun.mockResolvedValue({
                ok: true,
                value: {
                    dagRun: { dagRunId: 'run-1', dagId: 'dag-1', version: 1, status: 'running' },
                    taskRuns: []
                }
            });
            const app = createTestApp(sseClients, runQuery, clock);
            const result = await makeSseRequest(app, '/v1/dag/runs/run-1/events');

            expect(result.status).toBe(200);
            // Should have at least the initial comment and a started event
            const allData = result.events.join('');
            expect(allData).toContain('execution.started');
        });

        it('streams completed event for successful run', async () => {
            runQuery.getRun.mockResolvedValue({
                ok: true,
                value: {
                    dagRun: { dagRunId: 'run-1', dagId: 'dag-1', version: 1, status: 'success' },
                    taskRuns: []
                }
            });
            const app = createTestApp(sseClients, runQuery, clock);
            const result = await makeSseRequest(app, '/v1/dag/runs/run-1/events');

            expect(result.status).toBe(200);
            const allData = result.events.join('');
            expect(allData).toContain('execution.completed');
        });

        it('streams failed event for failed run', async () => {
            runQuery.getRun.mockResolvedValue({
                ok: true,
                value: {
                    dagRun: { dagRunId: 'run-1', dagId: 'dag-1', version: 1, status: 'failed' },
                    taskRuns: []
                }
            });
            const app = createTestApp(sseClients, runQuery, clock);
            const result = await makeSseRequest(app, '/v1/dag/runs/run-1/events');

            expect(result.status).toBe(200);
            const allData = result.events.join('');
            expect(allData).toContain('execution.failed');
        });

        it('streams task-level events for running tasks', async () => {
            runQuery.getRun.mockResolvedValue({
                ok: true,
                value: {
                    dagRun: { dagRunId: 'run-1', dagId: 'dag-1', version: 1, status: 'running' },
                    taskRuns: [
                        {
                            taskRunId: 'task-1',
                            dagRunId: 'run-1',
                            nodeId: 'node-1',
                            status: 'running',
                            attempt: 1,
                            inputSnapshot: '{"key":"value"}'
                        }
                    ]
                }
            });
            const app = createTestApp(sseClients, runQuery, clock);
            const result = await makeSseRequest(app, '/v1/dag/runs/run-1/events');

            const allData = result.events.join('');
            expect(allData).toContain('task.started');
        });

        it('streams task completed events for successful tasks', async () => {
            runQuery.getRun.mockResolvedValue({
                ok: true,
                value: {
                    dagRun: { dagRunId: 'run-1', dagId: 'dag-1', version: 1, status: 'running' },
                    taskRuns: [
                        {
                            taskRunId: 'task-1',
                            dagRunId: 'run-1',
                            nodeId: 'node-1',
                            status: 'success',
                            attempt: 1,
                            inputSnapshot: '{"key":"value"}',
                            outputSnapshot: '{"result":"ok"}'
                        }
                    ]
                }
            });
            const app = createTestApp(sseClients, runQuery, clock);
            const result = await makeSseRequest(app, '/v1/dag/runs/run-1/events');

            const allData = result.events.join('');
            expect(allData).toContain('task.started');
            expect(allData).toContain('task.completed');
        });

        it('streams task failed events for failed tasks', async () => {
            runQuery.getRun.mockResolvedValue({
                ok: true,
                value: {
                    dagRun: { dagRunId: 'run-1', dagId: 'dag-1', version: 1, status: 'running' },
                    taskRuns: [
                        {
                            taskRunId: 'task-1',
                            dagRunId: 'run-1',
                            nodeId: 'node-1',
                            status: 'failed',
                            attempt: 1,
                            errorCode: 'TASK_ERROR',
                            errorMessage: 'failed'
                        }
                    ]
                }
            });
            const app = createTestApp(sseClients, runQuery, clock);
            const result = await makeSseRequest(app, '/v1/dag/runs/run-1/events');

            const allData = result.events.join('');
            expect(allData).toContain('task.started');
            expect(allData).toContain('task.failed');
        });

        it('streams error event and closes when run query fails', async () => {
            runQuery.getRun.mockResolvedValue({
                ok: false,
                error: {
                    code: 'NOT_FOUND',
                    category: 'validation',
                    message: 'Run not found',
                    retryable: false
                }
            });
            const app = createTestApp(sseClients, runQuery, clock);
            const result = await makeSseRequest(app, '/v1/dag/runs/run-1/events');

            expect(result.status).toBe(200);
            const allData = result.events.join('');
            expect(allData).toContain('execution.failed');
            expect(allData).toContain('NOT_FOUND');
        });

        it('handles upstream_failed task status', async () => {
            runQuery.getRun.mockResolvedValue({
                ok: true,
                value: {
                    dagRun: { dagRunId: 'run-1', dagId: 'dag-1', version: 1, status: 'running' },
                    taskRuns: [
                        {
                            taskRunId: 'task-1',
                            dagRunId: 'run-1',
                            nodeId: 'node-1',
                            status: 'upstream_failed',
                            attempt: 1
                        }
                    ]
                }
            });
            const app = createTestApp(sseClients, runQuery, clock);
            const result = await makeSseRequest(app, '/v1/dag/runs/run-1/events');

            const allData = result.events.join('');
            expect(allData).toContain('task.failed');
        });

        it('handles cancelled task status', async () => {
            runQuery.getRun.mockResolvedValue({
                ok: true,
                value: {
                    dagRun: { dagRunId: 'run-1', dagId: 'dag-1', version: 1, status: 'running' },
                    taskRuns: [
                        {
                            taskRunId: 'task-1',
                            dagRunId: 'run-1',
                            nodeId: 'node-1',
                            status: 'cancelled',
                            attempt: 1
                        }
                    ]
                }
            });
            const app = createTestApp(sseClients, runQuery, clock);
            const result = await makeSseRequest(app, '/v1/dag/runs/run-1/events');

            const allData = result.events.join('');
            expect(allData).toContain('task.failed');
        });

        it('handles cancelled run status', async () => {
            runQuery.getRun.mockResolvedValue({
                ok: true,
                value: {
                    dagRun: { dagRunId: 'run-1', dagId: 'dag-1', version: 1, status: 'cancelled' },
                    taskRuns: []
                }
            });
            const app = createTestApp(sseClients, runQuery, clock);
            const result = await makeSseRequest(app, '/v1/dag/runs/run-1/events');

            const allData = result.events.join('');
            expect(allData).toContain('execution.failed');
        });
    });
});
