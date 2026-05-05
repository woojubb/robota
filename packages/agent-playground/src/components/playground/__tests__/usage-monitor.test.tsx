import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UsageMonitor } from '../usage-monitor';

const FETCH_DELAY_MS = 500;

function mockUsageRandom(): void {
  vi.spyOn(Math, 'random')
    .mockReturnValueOnce(0.5)
    .mockReturnValueOnce(0.9)
    .mockReturnValueOnce(0.8)
    .mockReturnValueOnce(0.4)
    .mockReturnValueOnce(0.5)
    .mockReturnValueOnce(0.75)
    .mockReturnValue(0);
}

async function resolveUsageFetch(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(FETCH_DELAY_MS);
  });
}

describe('UsageMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not render or fetch usage data while hidden', async () => {
    render(<UsageMonitor isVisible={false} />);

    await resolveUsageFetch();

    expect(screen.queryByText('Usage Monitor')).not.toBeInTheDocument();
  });

  it('renders current usage, rate limits, and feature availability when visible', async () => {
    mockUsageRandom();

    render(<UsageMonitor isVisible />);

    expect(screen.queryByText('Usage Monitor')).not.toBeInTheDocument();

    await resolveUsageFetch();

    expect(screen.getByText('Usage Monitor')).toBeInTheDocument();
    expect(screen.getByText(/^Updated /)).toBeInTheDocument();
    expect(screen.getByText('Daily Executions')).toBeInTheDocument();
    expect(screen.getByText('7 / 100')).toBeInTheDocument();
    expect(screen.getByText('Active Sessions')).toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    expect(screen.getByText('Tokens Used')).toBeInTheDocument();
    expect(screen.getByText('240 / 1000')).toBeInTheDocument();
    expect(screen.getByText('Rate Limits')).toBeInTheDocument();
    expect(screen.getByText('2 remaining')).toBeInTheDocument();
    expect(screen.getByText('25 remaining')).toBeInTheDocument();
    expect(screen.getByText('75 remaining')).toBeInTheDocument();
    expect(screen.getByText('Available Features')).toBeInTheDocument();
    expect(screen.getByText('Streaming')).toBeInTheDocument();
    expect(screen.getByText('Tools')).toBeInTheDocument();
    expect(screen.getByText('Custom Templates')).toBeInTheDocument();
  });

  it('calls onClose from the close action', async () => {
    const onClose = vi.fn();
    mockUsageRandom();

    render(<UsageMonitor isVisible onClose={onClose} />);
    await resolveUsageFetch();

    fireEvent.click(screen.getByText('×'));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
