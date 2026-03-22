/**
 * Cross-package integration tests: SDK config -> Core hook runner.
 *
 * Verifies the full chain from hook config loading through core's runHooks
 * with all 4 executor types registered (command, http, prompt, agent).
 * Also verifies BundlePlugin skills flow into the system prompt builder.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runHooks } from '@robota-sdk/agent-core';
import type { THooksConfig, IHookInput, IHookTypeExecutor } from '@robota-sdk/agent-core';

import { PromptExecutor, AgentExecutor } from '../hooks/index.js';
import type { IPromptProvider } from '../hooks/index.js';
import { BundlePluginLoader } from '../plugins/index.js';
import type { IBundleSkill, ILoadedBundlePlugin } from '../plugins/index.js';
import { buildSystemPrompt } from '../context/system-prompt-builder.js';
import type { ISystemPromptParams } from '../context/system-prompt-builder.js';

let tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cross-pkg-hooks-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

/**
 * Create a mock command executor that implements IHookTypeExecutor.
 * We cannot import CommandExecutor directly (not in public API),
 * so we use the mock to test the dispatch chain.
 */
function createMockCommandExecutor(exitCode = 0, stdout = '', stderr = ''): IHookTypeExecutor {
  return {
    type: 'command',
    execute: vi.fn().mockResolvedValue({ exitCode, stdout, stderr }),
  };
}

function createMockHttpExecutor(): IHookTypeExecutor {
  return {
    type: 'http',
    execute: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '{}', stderr: '' }),
  };
}

describe('Cross-package: config -> hook runner', () => {
  it('should execute command hooks via core runHooks with default executors', async () => {
    const config: THooksConfig = {
      PreToolUse: [
        {
          matcher: 'bash',
          hooks: [{ type: 'command', command: 'echo "hook-executed"' }],
        },
      ],
    };

    const input: IHookInput = {
      session_id: 'test-session-1',
      cwd: process.cwd(),
      hook_event_name: 'PreToolUse',
      tool_name: 'bash',
      tool_input: { command: 'ls' },
    };

    // Use default executors (command + http from agent-core internals)
    const result = await runHooks(config, 'PreToolUse', input);

    // echo exits 0, so the hook should not block
    expect(result.blocked).toBe(false);
  });

  it('should block when command hook exits with code 2 via default executor', async () => {
    const config: THooksConfig = {
      PreToolUse: [
        {
          matcher: 'dangerous',
          hooks: [{ type: 'command', command: 'echo "denied" >&2; exit 2' }],
        },
      ],
    };

    const input: IHookInput = {
      session_id: 'test-session-2',
      cwd: process.cwd(),
      hook_event_name: 'PreToolUse',
      tool_name: 'dangerous',
    };

    const result = await runHooks(config, 'PreToolUse', input);

    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('denied');
  });

  it('should not match hooks when tool name does not match matcher', async () => {
    const config: THooksConfig = {
      PreToolUse: [
        {
          matcher: 'bash',
          hooks: [{ type: 'command', command: 'exit 2' }],
        },
      ],
    };

    const input: IHookInput = {
      session_id: 'test-session-3',
      cwd: process.cwd(),
      hook_event_name: 'PreToolUse',
      tool_name: 'read', // Does not match "bash"
    };

    const result = await runHooks(config, 'PreToolUse', input);

    expect(result.blocked).toBe(false);
  });

  it('should pass all 4 executor types (command, http, prompt, agent) to runner', async () => {
    const mockProvider: IPromptProvider = {
      complete: vi.fn().mockResolvedValue('{"ok": true}'),
    };

    const executors: IHookTypeExecutor[] = [
      createMockCommandExecutor(),
      createMockHttpExecutor(),
      new PromptExecutor({
        providerFactory: () => mockProvider,
      }),
      new AgentExecutor({
        sessionFactory: () => ({
          run: vi.fn().mockResolvedValue('{"ok": true}'),
        }),
      }),
    ];

    // Verify all 4 types are registered
    const types = executors.map((e) => e.type);
    expect(types).toEqual(['command', 'http', 'prompt', 'agent']);

    // Use a prompt-type hook to verify SDK executors work with core runner
    const config: THooksConfig = {
      PreToolUse: [
        {
          matcher: '',
          hooks: [{ type: 'prompt', prompt: 'Is this safe?' }],
        },
      ],
    };

    const input: IHookInput = {
      session_id: 'test-session-4',
      cwd: process.cwd(),
      hook_event_name: 'PreToolUse',
      tool_name: 'bash',
    };

    const result = await runHooks(config, 'PreToolUse', input, executors);

    expect(result.blocked).toBe(false);
    expect(mockProvider.complete).toHaveBeenCalledOnce();
  });

  it('should dispatch prompt executor and block when AI returns ok:false', async () => {
    const mockProvider: IPromptProvider = {
      complete: vi.fn().mockResolvedValue('{"ok": false, "reason": "Unsafe operation"}'),
    };

    const executors: IHookTypeExecutor[] = [
      createMockCommandExecutor(),
      createMockHttpExecutor(),
      new PromptExecutor({ providerFactory: () => mockProvider }),
      new AgentExecutor({
        sessionFactory: () => ({
          run: vi.fn().mockResolvedValue('{"ok": true}'),
        }),
      }),
    ];

    const config: THooksConfig = {
      PreToolUse: [
        {
          matcher: '',
          hooks: [{ type: 'prompt', prompt: 'Check safety' }],
        },
      ],
    };

    const input: IHookInput = {
      session_id: 'test-session-5',
      cwd: process.cwd(),
      hook_event_name: 'PreToolUse',
      tool_name: 'write',
    };

    const result = await runHooks(config, 'PreToolUse', input, executors);

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('Unsafe operation');
  });

  it('should dispatch agent executor via core runner', async () => {
    const mockRun = vi.fn().mockResolvedValue('{"ok": true}');

    const executors: IHookTypeExecutor[] = [
      new AgentExecutor({
        sessionFactory: (opts: { maxTurns?: number; timeout?: number }) => {
          expect(opts.maxTurns).toBe(10);
          return { run: mockRun };
        },
      }),
    ];

    const config: THooksConfig = {
      PreToolUse: [
        {
          matcher: '',
          hooks: [{ type: 'agent', agent: 'security-reviewer', maxTurns: 10 }],
        },
      ],
    };

    const input: IHookInput = {
      session_id: 'test-session-6',
      cwd: process.cwd(),
      hook_event_name: 'PreToolUse',
      tool_name: 'bash',
    };

    const result = await runHooks(config, 'PreToolUse', input, executors);

    expect(result.blocked).toBe(false);
    expect(mockRun).toHaveBeenCalledOnce();
  });

  it('should skip hooks with unknown executor type gracefully', async () => {
    const commandExecutor = createMockCommandExecutor();
    const executors: IHookTypeExecutor[] = [commandExecutor];

    // Config uses 'prompt' type but only command executor is registered
    const config: THooksConfig = {
      PreToolUse: [
        {
          matcher: '',
          hooks: [
            { type: 'prompt', prompt: 'Check this' },
            { type: 'command', command: 'echo "ran"' },
          ],
        },
      ],
    };

    const input: IHookInput = {
      session_id: 'test-session-7',
      cwd: process.cwd(),
      hook_event_name: 'PreToolUse',
      tool_name: 'bash',
    };

    // Should not throw, prompt hook is skipped, command hook runs
    const result = await runHooks(config, 'PreToolUse', input, executors);
    expect(result.blocked).toBe(false);
    expect(commandExecutor.execute).toHaveBeenCalledOnce();
  });

  it('should return early when config is undefined', async () => {
    const input: IHookInput = {
      session_id: 'test-session-8',
      cwd: process.cwd(),
      hook_event_name: 'PreToolUse',
      tool_name: 'bash',
    };

    const result = await runHooks(undefined, 'PreToolUse', input);
    expect(result.blocked).toBe(false);
  });

  it('should handle multiple hook events in same config', async () => {
    const preExecutor = createMockCommandExecutor();
    const postExecutor = createMockCommandExecutor();

    // Use distinct mock executors to track calls per event
    const config: THooksConfig = {
      PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'pre-check' }] }],
      PostToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'post-check' }] }],
    };

    const input: IHookInput = {
      session_id: 'test-session-9',
      cwd: process.cwd(),
      hook_event_name: 'PreToolUse',
      tool_name: 'bash',
    };

    // Pre event
    const preResult = await runHooks(config, 'PreToolUse', input, [preExecutor]);
    expect(preResult.blocked).toBe(false);
    expect(preExecutor.execute).toHaveBeenCalledOnce();

    // Post event
    const postInput: IHookInput = { ...input, hook_event_name: 'PostToolUse' };
    const postResult = await runHooks(config, 'PostToolUse', postInput, [postExecutor]);
    expect(postResult.blocked).toBe(false);
    expect(postExecutor.execute).toHaveBeenCalledOnce();
  });
});

describe('Cross-package: BundlePlugin -> system prompt', () => {
  it('should load plugin skills and inject into system prompt', async () => {
    const tempDir = createTempDir();
    const pluginDir = join(tempDir, 'cache', 'market', 'my-plugin', '1.0.0');
    const metaDir = join(pluginDir, '.claude-plugin');
    const skillDir = join(pluginDir, 'skills', 'deploy');

    mkdirSync(metaDir, { recursive: true });
    mkdirSync(skillDir, { recursive: true });

    writeFileSync(
      join(metaDir, 'plugin.json'),
      JSON.stringify({
        name: 'my-plugin',
        version: '1.0.0',
        description: 'Test plugin',
        features: { skills: true },
      }),
    );

    writeFileSync(
      join(skillDir, 'SKILL.md'),
      [
        '---',
        'description: Deploy application to production',
        '---',
        '# Deploy Skill',
        'Steps to deploy...',
      ].join('\n'),
    );

    const loader = new BundlePluginLoader(tempDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0]!.skills).toHaveLength(1);

    const skill = plugins[0]!.skills[0]!;
    expect(skill.name).toBe('deploy@my-plugin');
    expect(skill.description).toBe('Deploy application to production');

    // Now pass to buildSystemPrompt
    const params: ISystemPromptParams = {
      agentsMd: '',
      claudeMd: '',
      toolDescriptions: [],
      trustLevel: 'moderate',
      projectInfo: { type: 'unknown', language: 'unknown' },
      skills: plugins[0]!.skills.map((s) => ({
        name: s.name,
        description: s.description,
      })),
    };

    const prompt = buildSystemPrompt(params);

    expect(prompt).toContain('## Skills');
    expect(prompt).toContain('deploy@my-plugin');
    expect(prompt).toContain('Deploy application to production');
  });

  it('should load multiple plugin skills from different plugins', async () => {
    const tempDir = createTempDir();

    // Plugin A (in cache/<marketplace>/<plugin>/<version>/)
    const pluginA = join(tempDir, 'cache', 'market-a', 'plugin-a', '1.0.0');
    mkdirSync(join(pluginA, '.claude-plugin'), { recursive: true });
    mkdirSync(join(pluginA, 'skills', 'lint'), { recursive: true });

    writeFileSync(
      join(pluginA, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'plugin-a',
        version: '1.0.0',
        description: 'Plugin A',
        features: { skills: true },
      }),
    );
    writeFileSync(
      join(pluginA, 'skills', 'lint', 'SKILL.md'),
      '---\ndescription: Lint code\n---\n# Lint',
    );

    // Plugin B
    const pluginB = join(tempDir, 'cache', 'market-b', 'plugin-b', '2.0.0');
    mkdirSync(join(pluginB, '.claude-plugin'), { recursive: true });
    mkdirSync(join(pluginB, 'skills', 'format'), { recursive: true });

    writeFileSync(
      join(pluginB, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'plugin-b',
        version: '2.0.0',
        description: 'Plugin B',
        features: { skills: true },
      }),
    );
    writeFileSync(
      join(pluginB, 'skills', 'format', 'SKILL.md'),
      '---\ndescription: Format code\n---\n# Format',
    );

    const loader = new BundlePluginLoader(tempDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(2);

    // Collect all skills for system prompt
    const allSkills = plugins.flatMap((p: ILoadedBundlePlugin) =>
      p.skills.map((s: IBundleSkill) => ({ name: s.name, description: s.description })),
    );

    const prompt = buildSystemPrompt({
      agentsMd: '',
      claudeMd: '',
      toolDescriptions: [],
      trustLevel: 'moderate',
      projectInfo: { type: 'unknown', language: 'unknown' },
      skills: allSkills,
    });

    expect(prompt).toContain('lint@plugin-a');
    expect(prompt).toContain('Lint code');
    expect(prompt).toContain('format@plugin-b');
    expect(prompt).toContain('Format code');
  });
});
