import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IndividualPluginBlock } from '../individual-plugin-block';
import {
  PLUGIN_CATEGORIES,
  PLUGIN_PRIORITIES,
  type IPluginBlock,
} from '../plugin-container-block-types';

function createPluginBlock(overrides: Partial<IPluginBlock> = {}): IPluginBlock {
  return {
    id: 'history-plugin',
    plugin: {
      name: 'HistoryPlugin',
      version: '1.2.3',
      initialize: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    },
    isActive: false,
    isEnabled: true,
    category: PLUGIN_CATEGORIES.STORAGE,
    priority: PLUGIN_PRIORITIES.DEFAULT,
    options: {
      enabled: true,
      maxEvents: 1000,
      strategy: 'auto',
    },
    stats: {
      calls: 4,
      errors: 1,
      lastActivity: new Date('2026-05-05T12:00:00Z'),
    },
    validationErrors: [],
    ...overrides,
  };
}

function renderBlock(overrides: Partial<IPluginBlock> = {}, isEditable = true) {
  const onUpdate = vi.fn();
  const onRemove = vi.fn();
  const onToggle = vi.fn();

  render(
    <IndividualPluginBlock
      pluginBlock={createPluginBlock(overrides)}
      onUpdate={onUpdate}
      onRemove={onRemove}
      onToggle={onToggle}
      isEditable={isEditable}
    />,
  );

  return { onUpdate, onRemove, onToggle };
}

function expandBlock(): void {
  fireEvent.click(screen.getByText('HistoryPlugin'));
}

describe('IndividualPluginBlock', () => {
  it('renders collapsed plugin summary, status, category, call count, and validation error', () => {
    renderBlock({
      validationErrors: ['Missing storage config'],
      stats: { calls: 2, errors: 1 },
    });

    expect(screen.getByText('HistoryPlugin')).toBeInTheDocument();
    expect(screen.getByText('Priority: 10')).toBeInTheDocument();
    expect(screen.getByText('STORAGE')).toBeInTheDocument();
    expect(screen.getByText('2 calls')).toBeInTheDocument();
    expect(screen.getByText('1 errors')).toBeInTheDocument();
    expect(screen.getByText('Missing storage config')).toBeInTheDocument();
  });

  it('updates and notifies when the enabled switch is toggled', () => {
    const { onUpdate, onToggle } = renderBlock();

    fireEvent.click(screen.getByRole('switch'));

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'history-plugin',
        isEnabled: false,
      }),
    );
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('renders options after expansion and updates edited values', () => {
    const { onUpdate } = renderBlock();

    expandBlock();
    fireEvent.change(screen.getByPlaceholderText('Maximum events to store'), {
      target: { value: '250' },
    });

    expect(screen.queryByText('No configuration options available')).not.toBeInTheDocument();
    expect(screen.getByText('maxEvents')).toBeInTheDocument();
    expect(screen.getByText('Logging strategy')).toBeInTheDocument();
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ maxEvents: 250 }),
      }),
    );
  });

  it('shows execution statistics and success rate on the stats tab', async () => {
    renderBlock();

    expandBlock();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /stats/i }));

    expect(await screen.findByText('Total Calls')).toBeInTheDocument();
    expect(screen.getByText('Errors')).toBeInTheDocument();
    expect(screen.getByText('Success Rate')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('shows plugin metadata on the info tab', async () => {
    renderBlock();

    expandBlock();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /info/i }));

    expect(await screen.findByText('Version')).toBeInTheDocument();
    expect(screen.getByText('1.2.3')).toBeInTheDocument();
    expect(screen.getByText('10 (Higher numbers execute first)')).toBeInTheDocument();
  });
});
