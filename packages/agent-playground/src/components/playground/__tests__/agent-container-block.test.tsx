import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AgentContainerBlock } from '../agent-container-block';
import type {
  IPlaygroundAgentConfig,
  IPlaygroundPlugin,
} from '../../../lib/playground/robota-executor';

const plugin: IPlaygroundPlugin = {
  name: 'HistoryPlugin',
  version: '1.0.0',
  initialize: async () => undefined,
  dispose: async () => undefined,
};

const agent: IPlaygroundAgentConfig = {
  id: 'agent-1',
  name: 'Planner',
  aiProviders: [],
  defaultModel: {
    provider: 'openai',
    model: 'gpt-4o',
    systemMessage: 'Plan the team response.',
  },
  tools: [
    {
      name: 'search',
      description: 'Search data',
      execute: async () => 'ok',
    },
    {
      name: 'calculator',
      description: 'Calculate values',
      execute: async () => 'ok',
    },
  ],
  plugins: [plugin],
};

function renderAgentBlock(overrides: Partial<ComponentProps<typeof AgentContainerBlock>> = {}) {
  const props: ComponentProps<typeof AgentContainerBlock> = {
    agent,
    index: 1,
    totalAgents: 3,
    teamRole: 'specialist',
    priority: 4,
    onAgentChange: vi.fn(),
    ...overrides,
  };

  return render(<AgentContainerBlock {...props} />);
}

describe('AgentContainerBlock', () => {
  it('renders collapsed team summary and expands agent details', () => {
    renderAgentBlock();

    expect(screen.getByText('Planner')).toBeInTheDocument();
    expect(screen.getByText('2/3')).toBeInTheDocument();
    expect(screen.getByText('Specialist')).toBeInTheDocument();
    expect(screen.getByText('openai')).toBeInTheDocument();
    expect(screen.getByText('gpt-4o')).toBeInTheDocument();
    expect(screen.getByText('P4')).toBeInTheDocument();
    expect(screen.queryByText('Team Role')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Planner'));

    expect(screen.getByText('Team Role')).toBeInTheDocument();
    expect(screen.getByText('Priority')).toBeInTheDocument();
    expect(screen.getByText('Capabilities')).toBeInTheDocument();
    expect(screen.getByText('2 tools')).toBeInTheDocument();
    expect(screen.getByText('1 plugins')).toBeInTheDocument();
    expect(screen.getByText('System Message')).toBeInTheDocument();
    expect(screen.getByText('Plan the team response.')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton')).toBeDisabled();
  });

  it('enables team editing and forwards priority changes', () => {
    const onPriorityChange = vi.fn();
    renderAgentBlock({ onPriorityChange });

    fireEvent.click(screen.getByText('Planner'));
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '6' } });

    expect(screen.getByRole('spinbutton')).not.toBeDisabled();
    expect(onPriorityChange).toHaveBeenCalledWith(6);
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('forwards leader, configure, remove, and drag callbacks', () => {
    const onSetLeader = vi.fn();
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    const onDragStart = vi.fn();
    const onDragOver = vi.fn();
    const onDrop = vi.fn();
    const { container } = renderAgentBlock({
      draggable: true,
      onSetLeader,
      onEdit,
      onRemove,
      onDragStart,
      onDragOver,
      onDrop,
    });

    fireEvent.click(screen.getByText('Planner'));
    fireEvent.click(screen.getByText('Set Leader'));
    fireEvent.click(screen.getByText('Configure'));
    const removeButton = container.querySelector('button.text-red-500');
    expect(removeButton).not.toBeNull();
    fireEvent.click(removeButton as HTMLButtonElement);

    const draggableCard = screen.getByText('Planner').closest('[draggable="true"]');
    expect(draggableCard).not.toBeNull();
    fireEvent.dragStart(draggableCard as HTMLElement);
    fireEvent.dragOver(draggableCard as HTMLElement);
    fireEvent.drop(draggableCard as HTMLElement);

    expect(onSetLeader).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onDragStart).toHaveBeenCalledOnce();
    expect(onDragOver).toHaveBeenCalledOnce();
    expect(onDrop).toHaveBeenCalledOnce();
  });
});
