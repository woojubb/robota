import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChatInterface } from '../chat-interface';

interface IDeferred<TValue> {
  promise: Promise<TValue>;
  resolve: (value: TValue) => void;
  reject: (reason: Error) => void;
}

function createDeferred<TValue>(): IDeferred<TValue> {
  let resolveDeferred: (value: TValue) => void = () => undefined;
  let rejectDeferred: (reason: Error) => void = () => undefined;

  const promise = new Promise<TValue>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });

  return {
    promise,
    resolve: resolveDeferred,
    reject: rejectDeferred,
  };
}

function getChatInput(): HTMLInputElement {
  return screen.getByRole('textbox') as HTMLInputElement;
}

describe('ChatInterface', () => {
  it('renders disabled empty state when the agent is not ready', () => {
    render(<ChatInterface isAgentReady={false} />);

    expect(screen.getByText('Not Ready')).toBeInTheDocument();
    expect(screen.getByText('Start a conversation')).toBeInTheDocument();
    expect(screen.getByText('Run your code first to activate your agent.')).toBeInTheDocument();
    expect(screen.getByText(/Click "Run" to compile your agent code/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Run your code first to enable chat')).toBeDisabled();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('sends a ready-agent message, shows loading state, and renders the assistant response', async () => {
    const response = createDeferred<string>();
    const onSendMessage = vi.fn(() => response.promise);

    render(<ChatInterface isAgentReady onSendMessage={onSendMessage} />);

    fireEvent.change(getChatInput(), { target: { value: 'Hello agent' } });
    fireEvent.click(screen.getByRole('button'));

    expect(onSendMessage).toHaveBeenCalledWith('Hello agent');
    expect(screen.getByText('Hello agent')).toBeInTheDocument();
    expect(screen.getByText('Agent is thinking...')).toBeInTheDocument();
    expect(getChatInput()).toBeDisabled();

    await act(async () => {
      response.resolve('Hello human');
      await response.promise;
    });

    expect(await screen.findByText('Hello human')).toBeInTheDocument();
    expect(screen.queryByText('Agent is thinking...')).not.toBeInTheDocument();
    expect(getChatInput()).toHaveValue('');
  });

  it('submits with Enter when ready', async () => {
    const onSendMessage = vi.fn(async () => 'Enter response');

    render(<ChatInterface isAgentReady onSendMessage={onSendMessage} />);

    fireEvent.change(getChatInput(), { target: { value: 'Send from keyboard' } });
    fireEvent.keyDown(getChatInput(), { key: 'Enter' });

    expect(await screen.findByText('Enter response')).toBeInTheDocument();
    expect(onSendMessage).toHaveBeenCalledWith('Send from keyboard');
  });

  it('shows an error message and restores the last user message for retry', async () => {
    const onSendMessage = vi.fn(async () => {
      throw new Error('failed');
    });

    render(<ChatInterface isAgentReady onSendMessage={onSendMessage} />);

    fireEvent.change(getChatInput(), { target: { value: 'Needs retry' } });
    fireEvent.click(screen.getByRole('button'));

    expect(
      await screen.findByText(
        'Sorry, I encountered an error while processing your message. Please try again.',
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Retry last message'));

    expect(getChatInput()).toHaveValue('Needs retry');
    expect(document.activeElement).toBe(getChatInput());
  });

  it('clears existing messages from the header action', async () => {
    const onSendMessage = vi.fn(async () => 'Clear response');

    render(<ChatInterface isAgentReady onSendMessage={onSendMessage} />);

    fireEvent.change(getChatInput(), { target: { value: 'Clear this chat' } });
    fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByText('Clear response')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Clear chat'));

    await waitFor(() => {
      expect(screen.queryByText('Clear this chat')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Start a conversation')).toBeInTheDocument();
  });
});
