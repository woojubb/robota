import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentNode } from '../assembly-canvas/nodes/agent-node';
import { ToolNode } from '../assembly-canvas/nodes/tool-node';

vi.mock('@xyflow/react', async () => {
  const actual = await import('@xyflow/react');
  return {
    ...actual,
    Handle: ({ type, position }: { type: string; position: string }) => (
      <div data-testid="handle" data-type={type} data-position={position} />
    ),
    Position: { Left: 'left', Right: 'right' },
  };
});

describe('AgentNode', () => {
  it('renders agent name, provider, and model', () => {
    render(
      <AgentNode
        data={{
          name: 'Test Agent',
          provider: 'openai',
          model: 'gpt-4o-mini',
          toolCount: 0,
        }}
      />,
    );

    expect(screen.getByText('Test Agent')).toBeTruthy();
    expect(screen.getByText('openai')).toBeTruthy();
    expect(screen.getByText('gpt-4o-mini')).toBeTruthy();
  });

  it('renders system message when provided', () => {
    render(
      <AgentNode
        data={{
          name: 'Agent',
          provider: 'anthropic',
          model: 'claude-3-5-haiku',
          systemMessage: 'You are a helpful assistant.',
          toolCount: 0,
        }}
      />,
    );

    expect(screen.getByText('You are a helpful assistant.')).toBeTruthy();
  });

  it('renders tool count badge when tools are connected', () => {
    render(
      <AgentNode
        data={{
          name: 'Agent',
          provider: 'openai',
          model: 'gpt-4o-mini',
          toolCount: 3,
        }}
      />,
    );

    expect(screen.getByText('3 tools connected')).toBeTruthy();
  });

  it('renders singular tool label for one tool', () => {
    render(
      <AgentNode
        data={{
          name: 'Agent',
          provider: 'openai',
          model: 'gpt-4o-mini',
          toolCount: 1,
        }}
      />,
    );

    expect(screen.getByText('1 tool connected')).toBeTruthy();
  });
});

describe('ToolNode', () => {
  it('renders tool name', () => {
    render(<ToolNode data={{ name: 'current_time', description: 'Returns the current time.' }} />);

    expect(screen.getByText('current_time')).toBeTruthy();
    expect(screen.getByText('Returns the current time.')).toBeTruthy();
  });

  it('renders without description', () => {
    render(<ToolNode data={{ name: 'no_desc_tool' }} />);

    expect(screen.getByText('no_desc_tool')).toBeTruthy();
  });
});
