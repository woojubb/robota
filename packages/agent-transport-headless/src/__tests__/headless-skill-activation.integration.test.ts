import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { InteractiveSession } from '@robota-sdk/agent-sdk';
import type { IInteractiveSessionOptions } from '@robota-sdk/agent-sdk';
import { createHeadlessTransport } from '../headless-transport.js';

type TStandardSessionOptions = Extract<
  IInteractiveSessionOptions,
  { cwd: string; provider: unknown }
>;
type TTestProvider = TStandardSessionOptions['provider'];
type TChatResponse = Awaited<ReturnType<TTestProvider['chat']>>;
type TToolCalls = Extract<TChatResponse, { role: 'assistant' }>['toolCalls'];
type TResolvedConfig = NonNullable<TStandardSessionOptions['config']>;

interface IObservedProvider {
  provider: TTestProvider;
  getChatCallCount(): number;
  getFirstCallToolNames(): string[];
  getFirstCallExecuteCommandEnum(): string[] | undefined;
  getFirstCallExecuteSkillEnum(): string[] | undefined;
  getToolResultContent(): string;
}

interface IObservedPromptProvider {
  provider: TTestProvider;
  getChatCallCount(): number;
  getPromptContent(): string;
}

function createTempSkill(cwd: string): void {
  const skillDir = join(cwd, '.agents', 'skills', 'audit');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    [
      '---',
      'name: audit',
      'description: Audit one file',
      '---',
      'Audit this file with the real skill runtime: $ARGUMENTS',
    ].join('\n'),
    'utf8',
  );
}

function createConfig(): TResolvedConfig {
  return {
    defaultTrustLevel: 'moderate',
    language: 'en',
    provider: {
      name: 'headless-test-provider',
      model: 'headless-test-model',
      apiKey: 'test-key',
    },
    permissions: { allow: [], deny: [] },
    env: {},
  };
}

function assistantMessage(content: string | null, toolCalls?: TToolCalls): TChatResponse {
  return {
    id: `assistant-${Math.random().toString(36).slice(2)}`,
    role: 'assistant',
    content,
    state: 'complete',
    timestamp: new Date(),
    ...(toolCalls !== undefined ? { toolCalls } : {}),
  };
}

function createSkillToolCallingProvider(): IObservedProvider {
  let chatCallCount = 0;
  let firstCallToolNames: string[] = [];
  let firstCallExecuteCommandEnum: string[] | undefined;
  let firstCallExecuteSkillEnum: string[] | undefined;
  let toolResultContent = '';

  const provider: TTestProvider = {
    name: 'headless-test-provider',
    version: '1.0.0',
    async chat(messages, options) {
      chatCallCount += 1;

      if (chatCallCount === 1) {
        firstCallToolNames = options?.tools?.map((tool) => tool.name) ?? [];
        const executeCommandSchema = options?.tools?.find((tool) => tool.name === 'ExecuteCommand');
        const commandEnum = executeCommandSchema?.parameters.properties['command']?.enum;
        firstCallExecuteCommandEnum = Array.isArray(commandEnum)
          ? commandEnum.map((value) => String(value))
          : undefined;
        const executeSkillSchema = options?.tools?.find((tool) => tool.name === 'ExecuteSkill');
        const skillEnum = executeSkillSchema?.parameters.properties['skill']?.enum;
        firstCallExecuteSkillEnum = Array.isArray(skillEnum)
          ? skillEnum.map((value) => String(value))
          : undefined;
        return assistantMessage(null, [
          {
            id: 'call_execute_skill',
            type: 'function',
            function: {
              name: 'ExecuteSkill',
              arguments: JSON.stringify({ skill: 'audit', args: 'src/index.ts' }),
            },
          },
        ]);
      }

      const toolMessage = messages.find(
        (message) => message.role === 'tool' && message.name === 'ExecuteSkill',
      );
      toolResultContent = toolMessage?.content ?? '';
      return assistantMessage('Headless skill activated');
    },
    async generateResponse() {
      return { content: 'unused' };
    },
    supportsTools() {
      return true;
    },
    validateConfig() {
      return true;
    },
  };

  return {
    provider,
    getChatCallCount: () => chatCallCount,
    getFirstCallToolNames: () => firstCallToolNames,
    getFirstCallExecuteCommandEnum: () => firstCallExecuteCommandEnum,
    getFirstCallExecuteSkillEnum: () => firstCallExecuteSkillEnum,
    getToolResultContent: () => toolResultContent,
  };
}

function createPromptObservingProvider(response: string): IObservedPromptProvider {
  let chatCallCount = 0;
  let promptContent = '';

  const provider: TTestProvider = {
    name: 'headless-test-provider',
    version: '1.0.0',
    async chat(messages) {
      chatCallCount += 1;
      promptContent = messages.map((message) => message.content).join('\n');
      return assistantMessage(response);
    },
    async generateResponse() {
      return { content: 'unused' };
    },
    supportsTools() {
      return true;
    },
    validateConfig() {
      return true;
    },
  };

  return {
    provider,
    getChatCallCount: () => chatCallCount,
    getPromptContent: () => promptContent,
  };
}

function captureStdout(): { writes: string[]; restore(): void } {
  const writes: string[] = [];
  const originalWrite = process.stdout.write;

  process.stdout.write = ((chunk: string | Uint8Array, encodingOrCallback?: unknown) => {
    writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    if (typeof encodingOrCallback === 'function') {
      encodingOrCallback();
    }
    return true;
  }) as typeof process.stdout.write;

  return {
    writes,
    restore() {
      process.stdout.write = originalWrite;
    },
  };
}

function parseJsonObject(input: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(input);
  expect(parsed).toBeTypeOf('object');
  expect(parsed).not.toBeNull();
  return parsed as Record<string, unknown>;
}

describe('headless transport skill activation integration', () => {
  let cwd: string | undefined;

  afterEach(() => {
    if (cwd) rmSync(cwd, { recursive: true, force: true });
    cwd = undefined;
  });

  it('executes model-invocable skills through ExecuteSkill in a headless session', async () => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-headless-skill-'));
    createTempSkill(cwd);
    const observed = createSkillToolCallingProvider();
    const session = new InteractiveSession({
      cwd,
      provider: observed.provider,
      config: createConfig(),
      permissionMode: 'bypassPermissions',
      bare: true,
    });
    const stdout = captureStdout();

    try {
      const transport = createHeadlessTransport({
        outputFormat: 'json',
        prompt: 'Audit src/index.ts',
      });

      session.attachTransport(transport);
      await transport.start();

      const output = parseJsonObject(stdout.writes.join('').trim());
      expect(transport.getExitCode()).toBe(0);
      expect(output).toMatchObject({
        type: 'result',
        result: 'Headless skill activated',
        subtype: 'success',
      });
      expect(output['session_id']).toBeTypeOf('string');
      expect(observed.getChatCallCount()).toBe(2);
      expect(observed.getFirstCallToolNames()).toContain('ExecuteSkill');
      expect(observed.getFirstCallExecuteCommandEnum()).toContain('skills');
      expect(observed.getFirstCallExecuteSkillEnum()).toEqual(['audit']);
      expect(observed.getToolResultContent()).toContain('"success":true');
      expect(observed.getToolResultContent()).toContain('<skill name=\\"audit\\">');
      expect(session.getSkillActivationEvents().map((event) => event.invocation)).toEqual([
        'model-tool',
        'model-tool',
      ]);
      expect(session.getSkillActivationEvents().map((event) => event.status)).toEqual([
        'started',
        'completed',
      ]);
    } finally {
      stdout.restore();
      await session.shutdown({
        reason: 'prompt_input_exit',
        message: 'Headless skill activation test complete',
      });
    }
  });

  it('executes explicit slash skills through SDK skill loading in a headless session', async () => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-headless-slash-skill-'));
    createTempSkill(cwd);
    const observed = createPromptObservingProvider('Headless slash skill activated');
    const session = new InteractiveSession({
      cwd,
      provider: observed.provider,
      config: createConfig(),
      permissionMode: 'bypassPermissions',
      bare: true,
    });
    const stdout = captureStdout();

    try {
      const transport = createHeadlessTransport({
        outputFormat: 'json',
        prompt: '/audit src/index.ts',
      });

      session.attachTransport(transport);
      await transport.start();

      const output = parseJsonObject(stdout.writes.join('').trim());
      expect(transport.getExitCode()).toBe(0);
      expect(output).toMatchObject({
        type: 'result',
        result: 'Headless slash skill activated',
        subtype: 'success',
      });
      expect(observed.getChatCallCount()).toBe(1);
      expect(observed.getPromptContent()).toContain(
        'Audit this file with the real skill runtime: src/index.ts',
      );
      expect(observed.getPromptContent()).toContain('<skill name="audit">');
      expect(session.getSkillActivationEvents().map((event) => event.invocation)).toEqual([
        'user-slash',
        'user-slash',
      ]);
      expect(session.getSkillActivationEvents().map((event) => event.status)).toEqual([
        'started',
        'completed',
      ]);
    } finally {
      stdout.restore();
      await session.shutdown({
        reason: 'prompt_input_exit',
        message: 'Headless slash skill activation test complete',
      });
    }
  });
});
