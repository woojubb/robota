import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ToolContainerBlock } from '../tool-container-block';
import type { IToolBlock } from '../tool-container-block-types';
import type { IPlaygroundTool } from '../../../lib/playground/robota-executor';

const searchTool: IPlaygroundTool = {
  name: 'search',
  description: 'Search data',
  schema: {
    name: 'search',
    description: 'Search data',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum results',
          default: 10,
        },
      },
      required: ['query'],
    },
  },
  execute: async () => 'ok',
};

function createToolBlock(overrides: Partial<IToolBlock> = {}): IToolBlock {
  return {
    id: 'tool-1',
    tool: searchTool,
    isActive: false,
    isEnabled: true,
    parameters: {
      query: 'current query',
      maxResults: 3,
    },
    validationErrors: [],
    ...overrides,
  };
}

function renderToolContainer(overrides: Partial<ComponentProps<typeof ToolContainerBlock>> = {}) {
  const onToolsChange = vi.fn();
  const onToolAdd = vi.fn();
  const onToolRemove = vi.fn();
  const onToolExecute = vi.fn();

  const props: ComponentProps<typeof ToolContainerBlock> = {
    tools: [],
    isEditable: true,
    onToolsChange,
    onToolAdd,
    onToolRemove,
    onToolExecute,
    ...overrides,
  };

  const result = render(<ToolContainerBlock {...props} />);

  return { ...result, onToolsChange, onToolAdd, onToolRemove, onToolExecute };
}

function expandTool(): void {
  fireEvent.click(screen.getByText('search'));
}

describe('ToolContainerBlock', () => {
  it('renders the empty editable state and adds a tool from the filtered library', () => {
    const { onToolsChange, onToolAdd } = renderToolContainer();

    expect(screen.getByText('Tools (0)')).toBeInTheDocument();
    expect(screen.getByText('No tools configured')).toBeInTheDocument();
    expect(screen.getByText('Click "Add Tool" to get started')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Add Tool'));
    fireEvent.change(screen.getByPlaceholderText('Search tools...'), {
      target: { value: 'calc' },
    });
    fireEvent.click(screen.getByText('calculator'));

    expect(onToolAdd).toHaveBeenCalledWith('calculator');
    expect(onToolsChange).toHaveBeenCalledWith([
      expect.objectContaining({
        tool: expect.objectContaining({
          name: 'calculator',
          description: 'Perform mathematical calculations',
        }),
        isEnabled: true,
        parameters: {},
        validationErrors: [],
      }),
    ]);
  });

  it('expands a configured tool and forwards parameter updates', () => {
    const { onToolsChange } = renderToolContainer({
      tools: [createToolBlock()],
    });

    expect(screen.getByText('Tools (1)')).toBeInTheDocument();
    expect(screen.getByText('Search data')).toBeInTheDocument();

    expandTool();

    expect(screen.getByText('Parameters')).toBeInTheDocument();
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getByText('Execution Preview')).toBeInTheDocument();
    expect(
      screen.getByText('search({"query":"current query","maxResults":3})'),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search query'), {
      target: { value: 'updated query' },
    });

    expect(onToolsChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'tool-1',
        parameters: expect.objectContaining({ query: 'updated query' }),
      }),
    ]);

    fireEvent.change(screen.getByPlaceholderText('Maximum results'), {
      target: { value: '7' },
    });

    expect(onToolsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        id: 'tool-1',
        parameters: expect.objectContaining({ maxResults: 7 }),
      }),
    ]);
  });

  it('toggles, executes, removes, and displays validation state for an editable tool', () => {
    const { container, onToolsChange, onToolExecute, onToolRemove } = renderToolContainer({
      tools: [createToolBlock({ validationErrors: ['Missing query'] })],
    });

    expect(screen.getByText('Missing query')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch'));

    expect(onToolsChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'tool-1',
        isEnabled: false,
      }),
    ]);

    const actionButtons = container.querySelectorAll('button.h-6.w-6');
    expect(actionButtons.length).toBe(2);
    fireEvent.click(actionButtons[0] as HTMLButtonElement);
    fireEvent.click(actionButtons[1] as HTMLButtonElement);

    expect(onToolExecute).toHaveBeenCalledWith('tool-1', {
      query: 'current query',
      maxResults: 3,
    });
    expect(onToolRemove).toHaveBeenCalledWith('tool-1');
    expect(onToolsChange).toHaveBeenLastCalledWith([]);
  });
});
