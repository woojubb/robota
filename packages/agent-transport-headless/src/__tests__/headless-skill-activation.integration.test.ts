import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { InteractiveSession } from '@robota-sdk/agent-sdk';
import { createSkillsCommandModule } from '@robota-sdk/agent-command-skills';
import type { TInteractiveSessionOptions } from '@robota-sdk/agent-sdk';
import { createHeadlessTransport } from '../headless-transport.js';

type TStandardSessionOptions = Extract<
  TInteractiveSessionOptions,
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
  getFirstCallSkillsToolArgsDescription(): string | undefined;
  getFirstPromptContent(): string;
  getToolResultContent(): string;
}

interface IObservedPromptProvider {
  provider: TTestProvider;
  getChatCallCount(): number;
  getPromptContent(): string;
}

interface IObservedUnknownToolProvider {
  provider: TTestProvider;
  getChatCallCount(): number;
  getToolResultContent(): string;
  getForcedInstruction(): string;
  getForcedCallToolNames(): string[] | undefined;
}

function createTempSkill(
  cwd: string,
  name: string,
  description: string,
  body = 'Run this skill with the real skill runtime: $ARGUMENTS',
): void {
  const skillDir = join(cwd, '.agents', 'skills', name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    ['---', `name: ${name}`, `description: ${description}`, '---', body].join('\n'),
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
  let firstCallSkillsToolArgsDescription: string | undefined;
  let firstPromptContent = '';
  let toolResultContent = '';

  const provider: TTestProvider = {
    name: 'headless-test-provider',
    version: '1.0.0',
    async chat(messages, options) {
      chatCallCount += 1;

      if (chatCallCount === 1) {
        firstPromptContent = messages.map((message) => message.content).join('\n');
        firstCallToolNames = options?.tools?.map((tool) => tool.name) ?? [];
        const skillsToolSchema = options?.tools?.find(
          (tool) => tool.name === 'robota_command_skills',
        );
        firstCallSkillsToolArgsDescription =
          skillsToolSchema?.parameters.properties['args']?.description;
        return assistantMessage(null, [
          {
            id: 'call_robota_command_skills',
            type: 'function',
            function: {
              name: 'robota_command_skills',
              arguments: JSON.stringify({ args: 'repo-writing docs/architecture.md' }),
            },
          },
        ]);
      }

      const toolMessage = messages.find(
        (message) => message.role === 'tool' && message.name === 'robota_command_skills',
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
    getFirstCallSkillsToolArgsDescription: () => firstCallSkillsToolArgsDescription,
    getFirstPromptContent: () => firstPromptContent,
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

function createUnknownToolCallingProvider(): IObservedUnknownToolProvider {
  let chatCallCount = 0;
  let toolResultContent = '';
  let forcedInstruction = '';
  let forcedCallToolNames: string[] | undefined;

  const provider: TTestProvider = {
    name: 'headless-test-provider',
    version: '1.0.0',
    async chat(messages, options) {
      chatCallCount += 1;

      if (chatCallCount <= 2) {
        return assistantMessage(null, [
          {
            id: `call_unknown_agent_${chatCallCount}`,
            type: 'function',
            function: {
              name: 'agent',
              arguments: JSON.stringify({ prompt: `spawn worker ${chatCallCount}` }),
            },
          },
        ]);
      }

      const toolMessage = [...messages]
        .reverse()
        .find((message) => message.role === 'tool' && message.name === 'agent');
      toolResultContent = toolMessage?.content ?? '';
      const userMessage = [...messages].reverse().find((message) => message.role === 'user');
      forcedInstruction = userMessage?.content ?? '';
      forcedCallToolNames = options?.tools?.map((tool) => tool.name);
      return assistantMessage('The agent tool was not executed because it is not registered.');
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
    getToolResultContent: () => toolResultContent,
    getForcedInstruction: () => forcedInstruction,
    getForcedCallToolNames: () => forcedCallToolNames,
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

  it('executes model-invocable skills through the skills built-in command in a headless session', async () => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-headless-skill-'));
    createTempSkill(
      cwd,
      'repo-writing',
      'Repository writing rules',
      'Apply repository writing rules with the real skill runtime: $ARGUMENTS',
    );
    const observed = createSkillToolCallingProvider();
    const session = new InteractiveSession({
      cwd,
      provider: observed.provider,
      config: createConfig(),
      permissionMode: 'bypassPermissions',
      bare: true,
      commandModules: [createSkillsCommandModule({ cwd })],
    });
    const stdout = captureStdout();

    try {
      const transport = createHeadlessTransport({
        outputFormat: 'json',
        prompt: 'Use repository writing rules for docs/architecture.md',
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
      expect(observed.getFirstCallToolNames()).toContain('robota_command_skills');
      expect(observed.getFirstCallToolNames()).not.toContain('ExecuteCommand');
      expect(observed.getFirstCallToolNames()).not.toContain('ExecuteSkill');
      expect(observed.getFirstCallSkillsToolArgsDescription()).toContain(
        '[list | <skill-name> [args]]',
      );
      expect(observed.getFirstPromptContent()).toContain('## Built-in Commands');
      expect(observed.getFirstPromptContent()).toContain('skills [list | <skill-name> [args]]');
      expect(observed.getFirstPromptContent()).toContain('## Skills');
      expect(observed.getFirstPromptContent()).toContain(
        '- repo-writing: Repository writing rules',
      );
      expect(observed.getToolResultContent()).toContain('"success":true');
      expect(observed.getToolResultContent()).toContain('<skill name=\\"repo-writing\\">');
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
    createTempSkill(
      cwd,
      'audit',
      'Audit one file',
      'Audit this file with the real skill runtime: $ARGUMENTS',
    );
    const observed = createPromptObservingProvider('Headless slash skill activated');
    const session = new InteractiveSession({
      cwd,
      provider: observed.provider,
      config: createConfig(),
      permissionMode: 'bypassPermissions',
      bare: true,
      commandModules: [createSkillsCommandModule({ cwd })],
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

  it('reports skipped unknown native tool calls through the headless execution path', async () => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-headless-unknown-tool-'));
    const observed = createUnknownToolCallingProvider();
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
        prompt: 'Spawn agents in parallel',
      });

      session.attachTransport(transport);
      await transport.start();

      const output = parseJsonObject(stdout.writes.join('').trim());
      expect(transport.getExitCode()).toBe(0);
      expect(output).toMatchObject({
        type: 'result',
        result: 'The agent tool was not executed because it is not registered.',
        subtype: 'success',
      });
      expect(observed.getChatCallCount()).toBe(3);
      expect(observed.getToolResultContent()).toContain('not registered');
      expect(observed.getToolResultContent()).toContain('not executed');
      expect(observed.getForcedInstruction()).toContain(
        'Those tool calls were not executed because they are not registered tools.',
      );
      expect(observed.getForcedInstruction()).toContain('agent');
      expect(observed.getForcedCallToolNames()).toBeUndefined();
    } finally {
      stdout.restore();
      await session.shutdown({
        reason: 'prompt_input_exit',
        message: 'Headless unknown tool test complete',
      });
    }
  });
});
