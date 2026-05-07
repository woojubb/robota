import { describe, expect, it } from 'vitest';
import { composeSystemPrompt } from '../system-prompt-composer.js';
import { createCapabilitySection } from '../system-prompt-section-providers.js';
import type { ISystemPromptSection } from '../system-prompt-types.js';

describe('system prompt composer', () => {
  it('orders and joins supplied sections without adding behavior text', () => {
    const sections: ISystemPromptSection[] = [
      {
        id: 'late',
        title: 'Late',
        priority: 20,
        content: 'Second',
        source: 'runtime',
      },
      {
        id: 'early',
        title: 'Early',
        priority: 10,
        content: 'First',
        source: 'framework',
      },
    ];

    const prompt = composeSystemPrompt(sections);

    expect(prompt).toBe('## Early\nFirst\n\n## Late\nSecond');
    expect(prompt).not.toContain('coding assistant');
    expect(prompt).not.toContain('web_search');
    expect(prompt).not.toContain('Agent tool');
  });

  it('renders registered capabilities without composer changes', () => {
    const section = createCapabilitySection([
      {
        name: 'agent',
        kind: 'builtin-command',
        description: 'Start, inspect, steer, stop, and close subagent jobs.',
        userInvocable: true,
        modelInvocable: true,
        argumentHint: 'run AGENT_NAME --background PROMPT',
        safety: 'background-agent',
      },
    ]);

    const prompt = composeSystemPrompt([section]);

    expect(prompt).toContain('agent');
    expect(prompt).not.toContain('/agent');
    expect(prompt).toContain('Start, inspect, steer, stop, and close subagent jobs.');
    expect(prompt).toContain('run AGENT_NAME --background PROMPT');
  });
});
