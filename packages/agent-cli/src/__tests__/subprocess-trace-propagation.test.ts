/**
 * End to end through the real session wrapper chain: with subprocess propagation on, the Bash child
 * sees a `TRACEPARENT` naming its own exported tool span, command hooks inside the prompt see the
 * prompt root, a hook outside any prompt sees nothing, and every spawner that inherits the
 * process environment sees nothing either.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { spawnInherited } from '@robota-sdk/agent-command';
import { FunctionTool } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { createManagedShellProcessRunner } from '@robota-sdk/agent-executor';
import { InteractiveSession, createNodeHostSettingsSource } from '@robota-sdk/agent-framework';
import { MCPActivationAdmissionService, MCPDefinitionRegistry, createStdioAdapter } from '@robota-sdk/agent-mcp';
import { createDefaultTools } from '@robota-sdk/agent-tool-defaults';

import type { TSubprocessTraceClass } from '@robota-sdk/agent-core';
import type { ILivePromptTraceBatch } from '@robota-sdk/agent-interface-analytics';

const AMBIENT = '00-99999999999999999999999999999999-8888888888888888-01';
const PRINT = '"${TRACEPARENT:--}|${TRACESTATE:--}"';

/**
 * Every child here runs with `home` as its cwd, so the command names its output file relative to it:
 * the shell text stays literal and no temp-directory path is interpolated into it.
 */
function printTo(name: string): string {
  return `printf "%s" ${PRINT} > 'out/${name}'`;
}

async function waitFor(path: string): Promise<string> {
  for (let attempt = 0; attempt < 200 && !existsSync(path); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return readFileSync(path, 'utf8');
}

describe.runIf(process.platform !== 'win32')('subprocess trace propagation through a real session', () => {
  let home: string;
  let out: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), 'robota-subprocess-traceparent-')));
    out = join(home, 'out');
    mkdirSync(out);
    mkdirSync(join(home, '.robota'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('TRACEPARENT', AMBIENT);
    vi.stubEnv('TRACESTATE', 'vendor=ambient');
    const hook = (name: string, extra = '') => [{ matcher: '', hooks: [{ type: 'command', command: `${printTo(name)}${extra}` }] }];
    writeFileSync(join(home, '.robota', 'settings.json'), JSON.stringify({
      hooks: {
        SessionStart: hook('session-start'),
        UserPromptSubmit: hook('prompt-submit', "; cat > 'out/prompt-stdin'"),
        PreToolUse: hook('pre-tool'),
        PostToolUse: hook('post-tool'),
      },
    }));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    // Hooks run as separate processes and some are not awaited by the session (PostToolUse fires
    // once per tool call), so on a slow runner a hook can still be writing into `out` as the test
    // ends. Remove the directory once those writes have landed, for up to ten seconds.
    for (let attempt = 0; ; attempt += 1) {
      try {
        rmSync(home, { recursive: true, force: true });
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY' || attempt >= 100) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  });

  /** Starts a local MCP stdio server process the way the product admits one. */
  async function startMcpStdio(path: string): Promise<void> {
    // A shell is refused as an MCP command, so the probe server is Node printing the same two values.
    const script = `const e = process.env; require('node:fs').writeFileSync(${JSON.stringify(path)}, (e.TRACEPARENT || '-') + '|' + (e.TRACESTATE || '-'));`;
    const args = ['-e', script];
    const definition = {
      name: 'probe', source: 'project' as const, origin: 'fixture', transport: 'stdio' as const,
      command: process.execPath, args, unsetVariables: [],
    };
    const request = new MCPDefinitionRegistry(
      [{ name: 'probe', source: 'project', origin: 'fixture', status: 'resolved', definition, shadowed: [] }],
      { workspace: { repositoryKey: home, trustState: 'trusted', generation: 1 } },
    ).list()[0]!;
    const admission = new MCPActivationAdmissionService();
    admission.approve(request);
    const adapter = createStdioAdapter({
      admission,
      authority: { allowedRoot: home, generation: '1', executables: [{ command: process.execPath, args: [args] }], environment: { HOME: home } },
    });
    const admitted = await adapter.admit({ definition, activation: request });
    if (!admitted.ok) throw new Error('the probe MCP server was not admitted');
    const transport = adapter.construct(admitted.admitted);
    await transport.start();
    await waitFor(path);
    await transport.close();
  }

  /** A tool body that starts the never-list spawners while the prompt's trace is live. */
  function neverListProbe() {
    return new FunctionTool({ name: 'NeverListProbe', description: 'probe', parameters: { type: 'object', properties: {} } }, async () => {
      writeFileSync(join(out, 'probe-process-env'), process.env['TRACEPARENT'] ?? '-');
      await spawnInherited('sh', ['-c', printTo('passthrough')], home);
      const handle = createManagedShellProcessRunner().start({
        taskId: 'bg-1',
        request: {
          kind: 'process', label: 'bg', mode: 'background', parentSessionId: 's', depth: 0, cwd: home,
          command: printTo('managed'),
        },
      });
      await handle.result;
      await startMcpStdio(join(out, 'mcp-stdio'));
      return 'probed';
    });
  }

  async function runPrompt(subprocesses: TSubprocessTraceClass[] | undefined): Promise<ILivePromptTraceBatch> {
    const bash = createDefaultTools({ cwd: home }).find((tool) => tool.getName() === 'Bash')!;
    const scripted = createScriptedProvider([
      { toolCalls: [{ name: 'Bash', args: { command: printTo('shell') } }] },
      { toolCalls: [{ name: 'NeverListProbe', args: {} }] },
      { text: 'done' },
    ]);
    const enqueue = vi.fn();
    const session = new InteractiveSession({
      cwd: home,
      provider: scripted.provider,
      bare: true,
      permissionMode: 'bypassPermissions',
      additionalTools: [bash, neverListProbe()],
      maxTurns: 4,
      userSettingsSources: [createNodeHostSettingsSource('user', join(home, '.robota', 'settings.json'))],
      livePromptTrace: {
        enqueue,
        ...(subprocesses ? { traceContextPropagation: { allowedOrigins: [], subprocesses } } : {}),
      },
    });
    try {
      const handle = await session.submit('run the shell');
      await handle.completed;
    } finally {
      await session.shutdown();
    }
    expect(enqueue).toHaveBeenCalledOnce();
    return enqueue.mock.calls[0]![0] as ILivePromptTraceBatch;
  }

  it('names the exported Bash span to the shell and the prompt root to command hooks', async () => {
    const before = { ...process.env };
    const batch = await runPrompt(['shell', 'hooks']);
    expect(process.env).toEqual(before);

    const [shellTraceparent, shellState] = (await waitFor(join(out, 'shell'))).split('|');
    expect(shellState).toBe('-');
    const [, traceId, spanId] = shellTraceparent!.split('-');
    const bashSpan = batch.children.flatMap((child) => (child.kind === 'tool' ? [child.trace] : []))[0];
    expect(batch.root.traceId).toBe(traceId);
    expect(bashSpan?.spanId).toBe(spanId);

    const root = `00-${batch.root.traceId}-${batch.root.spanId}-01|-`;
    for (const name of ['prompt-submit', 'pre-tool', 'post-tool']) expect(await waitFor(join(out, name))).toBe(root);
    expect(await waitFor(join(out, 'session-start'))).toBe(`${AMBIENT}|vendor=ambient`);
    const stdin = await waitFor(join(out, 'prompt-stdin'));
    expect(stdin).toContain('UserPromptSubmit');
    expect(stdin).not.toContain(batch.root.traceId);

    expect(readFileSync(join(out, 'probe-process-env'), 'utf8')).toBe(AMBIENT);
    expect(await waitFor(join(out, 'passthrough'))).toBe(`${AMBIENT}|vendor=ambient`);
    expect(await waitFor(join(out, 'managed'))).toBe(`${AMBIENT}|vendor=ambient`);
    // A stdio server's environment is the host-selected snapshot admitted for it, never a tool's.
    expect(await waitFor(join(out, 'mcp-stdio'))).toBe('-|-');
  });

  it('leaves every child with the ambient environment when propagation is off', async () => {
    await runPrompt(undefined);
    for (const name of ['shell', 'prompt-submit', 'pre-tool', 'post-tool', 'session-start']) {
      expect(await waitFor(join(out, name))).toBe(`${AMBIENT}|vendor=ambient`);
    }
    // The prompt hook writes its stdin copy after its trace line; wait for it before cleanup.
    await waitFor(join(out, 'prompt-stdin'));
  });

  it('gives only the enabled class the value', async () => {
    await runPrompt(['hooks']);
    expect(await waitFor(join(out, 'shell'))).toBe(`${AMBIENT}|vendor=ambient`);
    expect(await waitFor(join(out, 'pre-tool'))).not.toContain(AMBIENT);
  });
});
