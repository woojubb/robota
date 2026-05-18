import { describe, it, expect } from 'vitest';
import { generateAgentCode } from '../index';
import type { IAssemblyState } from '../index';

describe('generateAgentCode', () => {
  it('generates code with OpenAI + current-time tool', () => {
    const state: IAssemblyState = {
      agent: { provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'You are helpful.' },
      tools: ['current-time'],
      skills: [],
    };
    const code = generateAgentCode(state);

    expect(code).toContain("import { Robota } from '@robota-sdk/agent-core'");
    expect(code).toContain("import { OpenAIProvider } from '@robota-sdk/agent-provider/openai'");
    expect(code).toContain("import { createCurrentTimeTool } from '@robota-sdk/agent-tools'");
    expect(code).toContain('process.env.OPENAI_API_KEY');
    expect(code).toContain("provider: 'openai'");
    expect(code).toContain("model: 'gpt-4o-mini'");
    expect(code).toContain('You are helpful.');
    expect(code).toContain('tools: [createCurrentTimeTool()]');
    expect(code).toContain("robota.run('Your message here')");
    expect(code).toContain('robota.destroy()');
  });

  it('generates code with Anthropic provider using ANTHROPIC_API_KEY', () => {
    const state: IAssemblyState = {
      agent: { provider: 'anthropic', model: 'claude-3-5-haiku', systemPrompt: '' },
      tools: [],
      skills: [],
    };
    const code = generateAgentCode(state);

    expect(code).toContain('AnthropicProvider');
    expect(code).toContain('@robota-sdk/agent-provider/anthropic');
    expect(code).toContain('process.env.ANTHROPIC_API_KEY');
  });

  it('escapes backticks in system prompt', () => {
    const state: IAssemblyState = {
      agent: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'Use `code` and ${vars}.',
      },
      tools: [],
      skills: [],
    };
    const code = generateAgentCode(state);

    expect(code).toContain('\\`code\\`');
    expect(code).toContain('\\${vars}');
  });

  it('omits tools array when no tools', () => {
    const state: IAssemblyState = {
      agent: { provider: 'openai', model: 'gpt-4o-mini', systemPrompt: '' },
      tools: [],
      skills: [],
    };
    const code = generateAgentCode(state);

    expect(code).not.toContain('tools:');
  });

  it('omits systemMessage when system prompt is empty', () => {
    const state: IAssemblyState = {
      agent: { provider: 'openai', model: 'gpt-4o-mini', systemPrompt: '' },
      tools: [],
      skills: [],
    };
    const code = generateAgentCode(state);

    expect(code).not.toContain('systemMessage');
  });

  it('generates code with Gemini provider', () => {
    const state: IAssemblyState = {
      agent: { provider: 'gemini', model: 'gemini-2.0-flash', systemPrompt: '' },
      tools: [],
      skills: [],
    };
    const code = generateAgentCode(state);

    expect(code).toContain('GeminiProvider');
    expect(code).toContain('process.env.GEMINI_API_KEY');
  });

  it('appends skill system prompt additions to systemMessage', () => {
    const state: IAssemblyState = {
      agent: { provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'You are helpful.' },
      tools: [],
      skills: ['code-reviewer'],
    };
    const code = generateAgentCode(state);

    expect(code).toContain('You are helpful.');
    expect(code).toContain('You are an expert code reviewer.');
  });

  it('generates systemMessage from skill only when base prompt is empty', () => {
    const state: IAssemblyState = {
      agent: { provider: 'openai', model: 'gpt-4o-mini', systemPrompt: '' },
      tools: [],
      skills: ['summarizer'],
    };
    const code = generateAgentCode(state);

    expect(code).toContain('systemMessage');
    expect(code).toContain('You are an expert at summarizing content.');
  });
});
