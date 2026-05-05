import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AgentConfigurationBlock } from '../agent-configuration-block';
import type {
  IPlaygroundAgentConfig,
  IPlaygroundPlugin,
  IPlaygroundTool,
} from '../../../lib/playground/robota-executor';

class HistoryPlugin implements IPlaygroundPlugin {
  readonly name = 'HistoryPlugin';
  readonly version = '1.0.0';

  async initialize(): Promise<void> {
    return undefined;
  }

  async dispose(): Promise<void> {
    return undefined;
  }
}

const searchTool: IPlaygroundTool = {
  name: 'search',
  description: 'Search data',
  execute: async () => 'ok',
};

const agentConfig: IPlaygroundAgentConfig = {
  id: 'agent-1',
  name: 'Planner',
  aiProviders: [],
  defaultModel: {
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.7,
    maxTokens: 2000,
    systemMessage: 'Plan the response.',
  },
  tools: [searchTool],
  plugins: [new HistoryPlugin()],
};

function renderAgentConfiguration(
  overrides: Partial<ComponentProps<typeof AgentConfigurationBlock>> = {},
) {
  const props: ComponentProps<typeof AgentConfigurationBlock> = {
    config: agentConfig,
    onConfigChange: vi.fn(),
    ...overrides,
  };

  const result = render(<AgentConfigurationBlock {...props} />);

  return {
    ...result,
    props,
    onConfigChange: props.onConfigChange,
  };
}

describe('AgentConfigurationBlock', () => {
  it('renders model settings and forwards editable configuration changes', () => {
    const { onConfigChange } = renderAgentConfiguration();

    expect(screen.getByDisplayValue('Planner')).toBeInTheDocument();
    expect(screen.getByText('Provider')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Model/ })).toBeInTheDocument();
    expect(screen.getByText('Temperature')).toBeInTheDocument();
    expect(screen.getByText('Max Tokens')).toBeInTheDocument();
    expect(screen.getByText('System Message')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Planner'), {
      target: { value: 'Researcher' },
    });

    expect(onConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Researcher',
      }),
    );

    fireEvent.change(screen.getByPlaceholderText('You are a helpful AI assistant...'), {
      target: { value: 'Updated system message' },
    });

    expect(onConfigChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        defaultModel: expect.objectContaining({
          systemMessage: 'Updated system message',
        }),
      }),
    );

    const sliders = screen.getAllByRole('slider');
    fireEvent.change(sliders[0] as HTMLInputElement, { target: { value: '1.2' } });
    fireEvent.change(sliders[1] as HTMLInputElement, { target: { value: '2400' } });

    expect(onConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultModel: expect.objectContaining({
          temperature: 1.2,
        }),
      }),
    );
    expect(onConfigChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        defaultModel: expect.objectContaining({
          maxTokens: 2400,
        }),
      }),
    );
  });

  it('blocks execution for invalid configs and disables editing while running', () => {
    const onExecute = vi.fn();
    const invalidResult = renderAgentConfiguration({
      config: {
        ...agentConfig,
        name: '',
        defaultModel: {
          ...agentConfig.defaultModel,
          model: '',
        },
      },
      onExecute,
    });

    expect(screen.getByText('Agent name is required')).toBeInTheDocument();
    expect(screen.getByText('Model selection is required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Play/ })).toBeDisabled();

    invalidResult.unmount();

    const { onConfigChange } = renderAgentConfiguration({
      isExecuting: true,
    });

    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Play/ })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Planner')).toBeDisabled();

    fireEvent.change(screen.getByDisplayValue('Planner'), {
      target: { value: 'Ignored' },
    });

    expect(onConfigChange).not.toHaveBeenCalled();
    expect(onExecute).not.toHaveBeenCalled();
  });

  it('forwards header actions with the current edited config', () => {
    const onOpenChat = vi.fn();
    const onExecute = vi.fn();
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();
    const { container } = renderAgentConfiguration({
      onOpenChat,
      onExecute,
      onDuplicate,
      onDelete,
    });

    fireEvent.change(screen.getByDisplayValue('Planner'), {
      target: { value: 'Researcher' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    fireEvent.click(screen.getByRole('button', { name: /Play/ }));

    const iconButtons = container.querySelectorAll('button.h-7.w-7');
    expect(iconButtons).toHaveLength(2);
    fireEvent.click(iconButtons[0] as HTMLButtonElement);
    fireEvent.click(iconButtons[1] as HTMLButtonElement);

    const expectedConfig = expect.objectContaining({
      name: 'Researcher',
    });
    expect(onOpenChat).toHaveBeenCalledWith(expectedConfig);
    expect(onExecute).toHaveBeenCalledWith(expectedConfig);
    expect(onDuplicate).toHaveBeenCalledWith(expectedConfig);
    expect(onDelete).toHaveBeenCalledWith(expectedConfig);
  });

  it('renders tools, plugins, and settings tabs', () => {
    renderAgentConfiguration();

    const toolsTab = screen.getByRole('tab', { name: /Tools/ });
    fireEvent.mouseDown(toolsTab, { button: 0, ctrlKey: false });
    fireEvent.click(toolsTab);

    expect(screen.getByText('Available Tools (1)')).toBeInTheDocument();
    expect(screen.getByText('search')).toBeInTheDocument();
    expect(screen.getByText('Search data')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();

    const pluginsTab = screen.getByRole('tab', { name: /Plugins/ });
    fireEvent.mouseDown(pluginsTab, { button: 0, ctrlKey: false });
    fireEvent.click(pluginsTab);

    expect(screen.getByText('Active Plugins (1)')).toBeInTheDocument();
    expect(screen.getByText('HistoryPlugin')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();

    const settingsTab = screen.getByRole('tab', { name: /Settings/ });
    fireEvent.mouseDown(settingsTab, { button: 0, ctrlKey: false });
    fireEvent.click(settingsTab);

    expect(screen.getByText('Agent Name')).toBeInTheDocument();
    expect(screen.getAllByDisplayValue('Planner')).toHaveLength(2);
  });
});
