import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import ConfirmPrompt from '../ConfirmPrompt.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ConfirmPrompt', () => {
  it('renders message text', () => {
    const { lastFrame } = render(
      <ConfirmPrompt message="Are you sure?" onSelect={() => {}} />,
    );
    expect(lastFrame()).toContain('Are you sure?');
  });

  it('renders default Yes/No options', () => {
    const { lastFrame } = render(
      <ConfirmPrompt message="Confirm?" onSelect={() => {}} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Yes');
    expect(frame).toContain('No');
  });

  it('renders custom options', () => {
    const { lastFrame } = render(
      <ConfirmPrompt message="Pick" options={['A', 'B', 'C']} onSelect={() => {}} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('A');
    expect(frame).toContain('B');
    expect(frame).toContain('C');
  });

  it('first option is highlighted by default', () => {
    const { lastFrame } = render(
      <ConfirmPrompt message="Confirm?" onSelect={() => {}} />,
    );
    const frame = lastFrame()!;
    // The selected item has '> ' prefix
    expect(frame).toContain('> Yes');
  });

  it('selects first option on Enter', () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <ConfirmPrompt message="Confirm?" onSelect={onSelect} />,
    );
    stdin.write('\r');
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it('navigates to second option with arrow down and selects', async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <ConfirmPrompt message="Confirm?" onSelect={onSelect} />,
    );
    // Arrow down (move to No)
    stdin.write('\x1b[B');
    await delay(50);
    stdin.write('\r');
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('y shortcut selects first option (Yes)', () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <ConfirmPrompt message="Confirm?" onSelect={onSelect} />,
    );
    stdin.write('y');
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it('n shortcut selects second option (No)', () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <ConfirmPrompt message="Confirm?" onSelect={onSelect} />,
    );
    stdin.write('n');
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('y/n shortcuts do not work with more than 2 options', () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <ConfirmPrompt message="Pick" options={['A', 'B', 'C']} onSelect={onSelect} />,
    );
    stdin.write('y');
    stdin.write('n');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ignores input after selection (no double-fire)', () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <ConfirmPrompt message="Confirm?" onSelect={onSelect} />,
    );
    stdin.write('\r');
    stdin.write('\r');
    stdin.write('y');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
