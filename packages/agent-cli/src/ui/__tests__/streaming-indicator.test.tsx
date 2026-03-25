import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import StreamingIndicator from '../StreamingIndicator.js';

describe('StreamingIndicator', () => {
  it('renders empty when no tools and no text', () => {
    const { lastFrame } = render(<StreamingIndicator text="" activeTools={[]} />);
    expect(lastFrame()).not.toContain('Thinking');
  });

  it('shows Tools: section with running tool', () => {
    const { lastFrame } = render(
      <StreamingIndicator
        text=""
        activeTools={[{ toolName: 'Bash', firstArg: 'ls -la', isRunning: true }]}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Tools:');
    expect(frame).toContain('Bash(ls -la)');
  });

  it('shows ⟳ for running and ✓ for completed tools', () => {
    const { lastFrame } = render(
      <StreamingIndicator
        text=""
        activeTools={[
          { toolName: 'Read', firstArg: '/src/index.ts', isRunning: false },
          { toolName: 'Bash', firstArg: 'ls', isRunning: true },
        ]}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('✓ Read(/src/index.ts)');
    expect(frame).toContain('⟳ Bash(ls)');
  });

  it('shows Robota: section with streaming text', () => {
    const { lastFrame } = render(<StreamingIndicator text="Hello world" activeTools={[]} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Robota:');
    expect(frame).toContain('Hello world');
    expect(frame).not.toContain('Tools:');
  });

  it('shows Tools: before Robota: when both present', () => {
    const { lastFrame } = render(
      <StreamingIndicator
        text="Analyzing..."
        activeTools={[{ toolName: 'Read', firstArg: 'file.ts', isRunning: false }]}
      />,
    );
    const frame = lastFrame()!;
    const toolsIndex = frame.indexOf('Tools:');
    const robotaIndex = frame.indexOf('Robota:');
    expect(toolsIndex).toBeGreaterThanOrEqual(0);
    expect(robotaIndex).toBeGreaterThanOrEqual(0);
    expect(toolsIndex).toBeLessThan(robotaIndex);
  });

  it('does not show Thinking... when tools are active', () => {
    const { lastFrame } = render(
      <StreamingIndicator
        text=""
        activeTools={[{ toolName: 'Glob', firstArg: '**/*.md', isRunning: true }]}
      />,
    );
    expect(lastFrame()).not.toContain('Thinking...');
  });

  it('does not show Thinking... when text is present', () => {
    const { lastFrame } = render(<StreamingIndicator text="Some response" activeTools={[]} />);
    expect(lastFrame()).not.toContain('Thinking...');
  });

  it('shows multiple tools in order', () => {
    const { lastFrame } = render(
      <StreamingIndicator
        text=""
        activeTools={[
          { toolName: 'Read', firstArg: 'a.ts', isRunning: false },
          { toolName: 'Bash', firstArg: 'echo hi', isRunning: false },
          { toolName: 'Glob', firstArg: '**/*.md', isRunning: true },
        ]}
      />,
    );
    const frame = lastFrame()!;
    const readIdx = frame.indexOf('Read(a.ts)');
    const bashIdx = frame.indexOf('Bash(echo hi)');
    const globIdx = frame.indexOf('Glob(**/*.md)');
    expect(readIdx).toBeLessThan(bashIdx);
    expect(bashIdx).toBeLessThan(globIdx);
  });
});
