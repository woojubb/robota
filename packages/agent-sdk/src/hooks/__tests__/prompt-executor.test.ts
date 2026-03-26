import { describe, it, expect, vi } from 'vitest';
import { PromptExecutor } from '../prompt-executor.js';
import type { IPromptHookDefinition, IHookInput } from '@robota-sdk/agent-core';

const makeInput = (overrides?: Partial<IHookInput>): IHookInput => ({
  session_id: 'test-session',
  cwd: '/tmp',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  ...overrides,
});

describe('PromptExecutor', () => {
  it('should have type "prompt"', () => {
    const executor = new PromptExecutor({ providerFactory: vi.fn() });
    expect(executor.type).toBe('prompt');
  });

  it('should call provider factory with model from definition', async () => {
    const mockProvider = { complete: vi.fn().mockResolvedValue(JSON.stringify({ ok: true })) };
    const providerFactory = vi.fn().mockReturnValue(mockProvider);
    const executor = new PromptExecutor({ providerFactory });

    const definition: IPromptHookDefinition = {
      type: 'prompt',
      prompt: 'check this',
      model: 'gpt-4o-mini',
    };
    await executor.execute(definition, makeInput());

    expect(providerFactory).toHaveBeenCalledWith('gpt-4o-mini');
  });

  it('should call provider factory with undefined when no model in definition', async () => {
    const mockProvider = { complete: vi.fn().mockResolvedValue(JSON.stringify({ ok: true })) };
    const providerFactory = vi.fn().mockReturnValue(mockProvider);
    const executor = new PromptExecutor({ providerFactory });

    const definition: IPromptHookDefinition = { type: 'prompt', prompt: 'check this' };
    await executor.execute(definition, makeInput());

    expect(providerFactory).toHaveBeenCalledWith(undefined);
  });

  it('should use default model when configured and no model in definition', async () => {
    const mockProvider = { complete: vi.fn().mockResolvedValue(JSON.stringify({ ok: true })) };
    const providerFactory = vi.fn().mockReturnValue(mockProvider);
    const executor = new PromptExecutor({ providerFactory, defaultModel: 'claude-3-haiku' });

    const definition: IPromptHookDefinition = { type: 'prompt', prompt: 'check this' };
    await executor.execute(definition, makeInput());

    expect(providerFactory).toHaveBeenCalledWith('claude-3-haiku');
  });

  it('should pass hook input context as prompt to the provider', async () => {
    const mockProvider = { complete: vi.fn().mockResolvedValue(JSON.stringify({ ok: true })) };
    const providerFactory = vi.fn().mockReturnValue(mockProvider);
    const executor = new PromptExecutor({ providerFactory });

    const definition: IPromptHookDefinition = { type: 'prompt', prompt: 'Is this tool call safe?' };
    const input = makeInput({ tool_name: 'Write' });
    await executor.execute(definition, input);

    const promptArg = mockProvider.complete.mock.calls[0][0] as string;
    expect(promptArg).toContain('Is this tool call safe?');
    expect(promptArg).toContain(JSON.stringify(input));
  });

  it('should return exitCode 0 when AI response has ok: true', async () => {
    const mockProvider = { complete: vi.fn().mockResolvedValue(JSON.stringify({ ok: true })) };
    const providerFactory = vi.fn().mockReturnValue(mockProvider);
    const executor = new PromptExecutor({ providerFactory });

    const definition: IPromptHookDefinition = { type: 'prompt', prompt: 'check' };
    const result = await executor.execute(definition, makeInput());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"ok":true');
    expect(result.stderr).toBe('');
  });

  it('should return exitCode 2 with reason when AI response has ok: false', async () => {
    const response = JSON.stringify({ ok: false, reason: 'Dangerous operation' });
    const mockProvider = { complete: vi.fn().mockResolvedValue(response) };
    const providerFactory = vi.fn().mockReturnValue(mockProvider);
    const executor = new PromptExecutor({ providerFactory });

    const definition: IPromptHookDefinition = { type: 'prompt', prompt: 'check' };
    const result = await executor.execute(definition, makeInput());

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('Dangerous operation');
  });

  it('should return exitCode 2 with default reason when ok: false and no reason', async () => {
    const response = JSON.stringify({ ok: false });
    const mockProvider = { complete: vi.fn().mockResolvedValue(response) };
    const providerFactory = vi.fn().mockReturnValue(mockProvider);
    const executor = new PromptExecutor({ providerFactory });

    const definition: IPromptHookDefinition = { type: 'prompt', prompt: 'check' };
    const result = await executor.execute(definition, makeInput());

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('Blocked by prompt hook');
  });

  it('should return exitCode 1 when provider throws', async () => {
    const mockProvider = { complete: vi.fn().mockRejectedValue(new Error('API rate limit')) };
    const providerFactory = vi.fn().mockReturnValue(mockProvider);
    const executor = new PromptExecutor({ providerFactory });

    const definition: IPromptHookDefinition = { type: 'prompt', prompt: 'check' };
    const result = await executor.execute(definition, makeInput());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('API rate limit');
  });

  it('should return exitCode 1 when AI response is not valid JSON', async () => {
    const mockProvider = { complete: vi.fn().mockResolvedValue('not json at all') };
    const providerFactory = vi.fn().mockReturnValue(mockProvider);
    const executor = new PromptExecutor({ providerFactory });

    const definition: IPromptHookDefinition = { type: 'prompt', prompt: 'check' };
    const result = await executor.execute(definition, makeInput());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Failed to parse');
  });

  it('should handle JSON response embedded in markdown code blocks', async () => {
    const response = '```json\n{"ok": true}\n```';
    const mockProvider = { complete: vi.fn().mockResolvedValue(response) };
    const providerFactory = vi.fn().mockReturnValue(mockProvider);
    const executor = new PromptExecutor({ providerFactory });

    const definition: IPromptHookDefinition = { type: 'prompt', prompt: 'check' };
    const result = await executor.execute(definition, makeInput());

    expect(result.exitCode).toBe(0);
  });
});
