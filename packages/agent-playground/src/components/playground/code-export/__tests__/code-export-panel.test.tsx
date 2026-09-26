import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CodeExportPanel } from '../code-export-panel';
import type { IPlaygroundAgentConfig } from '../../../../lib/playground/robota-executor';

const mockAgentConfig: IPlaygroundAgentConfig = {
  id: 'agent-1',
  name: 'Test Agent',
  defaultModel: {
    provider: 'openai',
    model: 'gpt-4o-mini',
  },
  systemMessage: 'You are helpful.',
};

describe('CodeExportPanel', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows empty state when no agent configured', () => {
    render(<CodeExportPanel agentConfig={null} activeTools={[]} />);
    expect(screen.getByText('Create an agent to generate code')).toBeTruthy();
  });

  it('renders code after debounce with agent config', async () => {
    render(<CodeExportPanel agentConfig={mockAgentConfig} activeTools={[]} />);
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getAllByText(/robota-sdk/).length).toBeGreaterThan(0);
  });

  it('shows Copy Code button when agent is configured', () => {
    render(<CodeExportPanel agentConfig={mockAgentConfig} activeTools={[]} />);
    expect(screen.getByRole('button', { name: /Copy/i })).toBeTruthy();
  });

  it('calls clipboard.writeText on Copy click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<CodeExportPanel agentConfig={mockAgentConfig} activeTools={[]} />);
    const btn = screen.getByRole('button', { name: /Copy/i });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    fireEvent.click(btn);

    await vi.waitFor(() => expect(writeText).toHaveBeenCalled(), { timeout: 1000 });
  });

  it('says a provider without a code template is not supported instead of inventing code', () => {
    const qwenConfig = {
      ...mockAgentConfig,
      defaultModel: { provider: 'qwen', model: 'qwen-plus' },
    };
    render(<CodeExportPanel agentConfig={qwenConfig} activeTools={[]} />);

    expect(screen.getByText(/does not support the "qwen" provider/)).toBeTruthy();
    expect(screen.queryByText(/^npm install/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Copy/i })).toBeNull();
  });

  it('switches from an unsupported to a supported provider without failing', async () => {
    const qwenConfig = {
      ...mockAgentConfig,
      defaultModel: { provider: 'qwen', model: 'qwen-plus' },
    };
    const { rerender } = render(<CodeExportPanel agentConfig={qwenConfig} activeTools={[]} />);

    rerender(<CodeExportPanel agentConfig={mockAgentConfig} activeTools={[]} />);
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.getByText(/^npm install/).textContent).toContain(
      '@robota-sdk/agent-provider-openai',
    );
  });

  it('does not call a newly created agent unsupported while the code is pending', () => {
    const { rerender } = render(<CodeExportPanel agentConfig={null} activeTools={[]} />);

    rerender(<CodeExportPanel agentConfig={mockAgentConfig} activeTools={[]} />);

    expect(screen.queryByText(/does not support/)).toBeNull();
  });
});
