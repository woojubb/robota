import { describe, it, expect } from 'vitest';
import { generateAgentCode } from '../index';
import type { IAssemblyState } from '../index';

describe('generateAgentCode', () => {
  it('generates createQuery code for simple case (no skills)', () => {
    const state: IAssemblyState = {
      agent: { provider: 'anthropic', model: 'claude-3-5-haiku', systemPrompt: '' },
      tools: [],
      skills: [],
    };
    const code = generateAgentCode(state);

    expect(code).toContain("import { createQuery } from '@robota-sdk/agent-framework'");
    expect(code).toContain('AnthropicProvider');
    expect(code).toContain('@robota-sdk/agent-provider/anthropic');
    expect(code).toContain('process.env.ANTHROPIC_API_KEY');
    expect(code).toContain("permissionMode: 'bypassPermissions'");
    expect(code).toContain('createQuery(');
    expect(code).toContain("query('Your message here')");
    expect(code).not.toContain('InteractiveSession');
    expect(code).not.toContain('Robota');
  });

  it('generates InteractiveSession code when skills are present', () => {
    const state: IAssemblyState = {
      agent: { provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'You are helpful.' },
      tools: [],
      skills: ['code-reviewer'],
    };
    const code = generateAgentCode(state);

    expect(code).toContain("import { InteractiveSession } from '@robota-sdk/agent-framework'");
    expect(code).toContain('OpenAIProvider');
    expect(code).toContain('process.env.OPENAI_API_KEY');
    expect(code).toContain("permissionMode: 'bypassPermissions'");
    expect(code).toContain('InteractiveSession({');
    expect(code).toContain('cwd: process.cwd()');
    expect(code).toContain("session.submit('Your message here')");
    expect(code).toContain('session.shutdown()');
    expect(code).not.toContain('createQuery');
    expect(code).not.toContain('Robota');
  });

  it('generates createQuery code with OpenAI provider', () => {
    const state: IAssemblyState = {
      agent: { provider: 'openai', model: 'gpt-4o-mini', systemPrompt: '' },
      tools: ['current-time'],
      skills: [],
    };
    const code = generateAgentCode(state);

    expect(code).toContain("import { createQuery } from '@robota-sdk/agent-framework'");
    expect(code).toContain('OpenAIProvider');
    expect(code).toContain('process.env.OPENAI_API_KEY');
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

  it('omits systemPrompt option when system prompt is empty', () => {
    const state: IAssemblyState = {
      agent: { provider: 'openai', model: 'gpt-4o-mini', systemPrompt: '' },
      tools: [],
      skills: [],
    };
    const code = generateAgentCode(state);

    expect(code).not.toContain('systemPrompt:');
  });

  it('includes systemPrompt option when system prompt is set', () => {
    const state: IAssemblyState = {
      agent: { provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'You are helpful.' },
      tools: [],
      skills: [],
    };
    const code = generateAgentCode(state);

    expect(code).toContain('systemPrompt:');
    expect(code).toContain('You are helpful.');
  });

  it('generates createQuery code with Gemini provider', () => {
    const state: IAssemblyState = {
      agent: { provider: 'gemini', model: 'gemini-2.0-flash', systemPrompt: '' },
      tools: [],
      skills: [],
    };
    const code = generateAgentCode(state);

    expect(code).toContain('GeminiProvider');
    expect(code).toContain('process.env.GEMINI_API_KEY');
  });

  it('appends skill system prompt to systemPrompt option in InteractiveSession', () => {
    const state: IAssemblyState = {
      agent: { provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'You are helpful.' },
      tools: [],
      skills: ['code-reviewer'],
    };
    const code = generateAgentCode(state);

    expect(code).toContain('You are helpful.');
    expect(code).toContain('You are an expert code reviewer.');
    expect(code).toContain('InteractiveSession');
  });

  it('generates InteractiveSession with skill-only systemPrompt when base prompt is empty', () => {
    const state: IAssemblyState = {
      agent: { provider: 'openai', model: 'gpt-4o-mini', systemPrompt: '' },
      tools: [],
      skills: ['summarizer'],
    };
    const code = generateAgentCode(state);

    expect(code).toContain('systemPrompt:');
    expect(code).toContain('You are an expert at summarizing content.');
    expect(code).toContain('InteractiveSession');
  });

  it('includes maxTurns option when specified', () => {
    const state: IAssemblyState = {
      agent: { provider: 'anthropic', model: 'claude-3-5-haiku', systemPrompt: '' },
      tools: [],
      skills: [],
      maxTurns: 5,
    };
    const code = generateAgentCode(state);

    expect(code).toContain('maxTurns: 5');
  });

  it('uses custom permissionMode when specified', () => {
    const state: IAssemblyState = {
      agent: { provider: 'anthropic', model: 'claude-3-5-haiku', systemPrompt: '' },
      tools: [],
      skills: [],
      permissionMode: 'default',
    };
    const code = generateAgentCode(state);

    expect(code).toContain("permissionMode: 'default'");
  });
});
