/** Owner SDK provisioning through the real hosted CLI; provider transport is simulated. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Sandbox } from 'e2b/dist/index.mjs';
import { expect, it, vi } from 'vitest';
import { provisionE2BTaskWorker } from '../hosted/e2b-worker-provisioning.js';
import { hostedWorkerCliFixture } from './helpers/hosted-worker-cli.js';
import { scriptedHostedBroker } from './helpers/hosted-scripted-broker.js';

it.each([false, true])('runs the stock hosted CLI on a fresh checkpoint (conversation resume: %s)', async (resume) => {
  const fixture = await hostedWorkerCliFixture();
  let workspace: string | undefined;
  try {
    const checkpoint = Buffer.from(JSON.stringify({
      version: resume ? 2 : 1, id: 'stored-checkpoint',
      ...(resume ? { session: { schemaVersion: 1, record: {
        id: 'checkpoint-session', cwd: '/old/workspace',
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        systemPrompt: 'REVOKED_SYSTEM_PROMPT_CANARY', sandboxSnapshotId: 'REVOKED_VM_MEMORY_CANARY',
        messages: [
          { role: 'system', content: 'REVOKED_SYSTEM_MESSAGE_CANARY' },
          { role: 'user', content: 'RECOVERED_CONVERSATION_CANARY' },
          { role: 'assistant', content: 'Saved work is ready.' },
        ].map((message, index) => ({ ...message, id: `saved-${index}`, timestamp: '2026-01-01T00:00:00.000Z', state: 'complete', metadata: { trust: 'REVOKED_METADATA_CANARY' } })),
      } } } : {}),
      identity: { ...fixture.f.config.identity, actor: 'revoked-actor', runtime: 'old-runtime' },
      epoch: 2, worker: 'old-worker',
      files: [{ path: 'recovered.txt', base64: Buffer.from('RECOVERED_WORK_CANARY').toString('base64') }],
    }));
    const snapshot = { id: 'stored-checkpoint', digest: createHash('sha256').update(checkpoint).digest('hex') };
    const info = JSON.parse(readFileSync(fixture.providerInfo, 'utf8')) as Record<string, unknown>;
    vi.spyOn(Sandbox, 'create').mockImplementation(async (_template, options) => {
      info.metadata = options!.metadata;
      return {
        sandboxId: fixture.f.config.worker.resource,
        commands: { run: async (command: string) => {
          const stdout = execFileSync('/bin/sh', ['-c', command], { cwd: '/', env: { TMPDIR: fixture.f.directory }, encoding: 'utf8' });
          workspace = stdout.trim();
          expect(dirname(workspace)).toBe(fixture.f.directory);
          expect(statSync(workspace).mode & 0o777).toBe(0o700);
          return { exitCode: 0, stdout, stderr: '' };
        } },
        files: { write: async (path: string, bytes: ArrayBuffer | Uint8Array) => {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, bytes instanceof ArrayBuffer ? Buffer.from(bytes) : bytes);
        }, read: async (path: string) => readFileSync(path) },
      } as unknown as Sandbox;
    });
    vi.spyOn(Sandbox, 'getInfo').mockImplementation(async () => info as unknown as Awaited<ReturnType<typeof Sandbox.getInfo>>);
    const kill = vi.spyOn(Sandbox, 'kill').mockResolvedValue(true);
    const worker = await provisionE2BTaskWorker({
      identity: fixture.f.config.identity,
      epoch: fixture.f.config.epoch,
      templateId: 'fixture-template',
      apiKey: 'runtime-management-canary',
      brokerEndpoint: fixture.f.config.broker.endpoint,
      lifetimeMs: 55_000,
      requestTimeoutMs: 1000,
      signal: new AbortController().signal,
      snapshot,
      checkpoint,
    });
    expect(kill).not.toHaveBeenCalled();
    expect(worker.workspaceRoot).toBe(workspace);
    writeFileSync(fixture.providerInfo, JSON.stringify(info));
    fixture.f.writeConfig({ ...fixture.f.config, snapshot, lifetimeMs: 55_000 });
    fixture.f.setProofTransform((proof) => ({ ...proof, snapshot }));
    const execution = JSON.parse(readFileSync(fixture.execution, 'utf8')) as Record<string, unknown>;
    writeFileSync(fixture.execution, JSON.stringify({ ...execution, workspaceRoot: worker.workspaceRoot,
      ...(resume ? { resumeSession: (worker as unknown as { resumeSession: unknown }).resumeSession } : {}),
    }));
    const path = join(worker.workspaceRoot, 'recovered.txt');
    const broker = scriptedHostedBroker(fixture.f, (_body, index) => index === 0
      ? { tool: { name: 'Read', arguments: JSON.stringify({ filePath: path }) } }
      : { content: 'FRESH_RECOVERY_COMPLETE' });
    const result = await fixture.run(['-p', 'Read recovered work', '--permission-mode', 'bypassPermissions', ...(resume ? ['--resume', 'checkpoint-session'] : ['--no-session-persistence']), '--max-turns', '3']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('FRESH_RECOVERY_COMPLETE');
    if (resume) {
      expect(JSON.stringify(broker[0]?.body)).toContain('RECOVERED_CONVERSATION_CANARY');
      expect(JSON.stringify(broker)).not.toContain('REVOKED_SYSTEM');
      expect(JSON.stringify(broker)).not.toContain('REVOKED_VM_MEMORY');
      expect(JSON.stringify(broker)).not.toContain('REVOKED_METADATA');
      const saved = JSON.parse(readFileSync(join(fixture.state, 'sessions', 'checkpoint-session.json'), 'utf8')) as { record: { history: unknown } };
      expect(JSON.stringify(saved.record.history)).toContain('RECOVERED_CONVERSATION_CANARY');
      expect(JSON.stringify(saved.record.history)).not.toContain('REVOKED_');
    }
    const messages = (broker[1]?.body.input ?? broker[1]?.body.messages) as Array<Record<string, unknown>>;
    const output = messages.find((message) => (message.type === 'function_call_output' || message.role === 'tool') && (message.call_id ?? message.tool_call_id) === 'call-1');
    const value = JSON.parse(String(output?.output ?? output?.content)) as { success: boolean; output: string };
    expect(value.success).toBe(true);
    expect(value.output).toBe(`[File: ${path} (1 lines)]\n1\tRECOVERED_WORK_CANARY`);
    expect(broker.every((request) => request.authorization === 'Bearer synthetic-task-token')).toBe(true);
    const starts = readFileSync(fixture.processes, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { cwd: string; environment: Record<string, string> });
    expect(starts.some((start) => start.cwd === worker.workspaceRoot)).toBe(true);
    expect(JSON.stringify(starts)).not.toContain('runtime-management-canary');
    expect(JSON.stringify(starts)).not.toContain('runtime-upstream-canary');
  } finally {
    vi.restoreAllMocks();
    await fixture.close();
    if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true });
  }
}, 75000);
