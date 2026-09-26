// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AgentActivityPanel } from '../AgentActivityPanel.js';
import { ConversationView } from '../ConversationView.js';
import { PermissionPrompt } from '../PermissionPrompt.js';

import type { TPendingPrompt } from '../../hooks/prompt-state.js';

/**
 * A host can render one of the surface's components on its own, inside an app whose tokens share the
 * surface's names. Each root the package exports opens the `robota-ui` scope itself.
 */
describe('the surface components open their own robota-ui scope', () => {
  beforeAll(() => {
    // jsdom has no layout; the conversation scrolls itself to the end after each render.
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(cleanup);

  it('ConversationView', () => {
    const { container } = render(
      <ConversationView messages={[]} activeTools={[]} streamingText="" isThinking={false} />,
    );
    expect((container.firstElementChild as HTMLElement).classList).toContain('robota-ui');
  });

  it('PermissionPrompt, docked and as a modal', () => {
    const prompt = {
      kind: 'permission',
      id: 'p1',
      toolName: 'Bash',
      toolArgs: { command: 'ls' },
    } as TPendingPrompt;
    for (const layout of ['dock', 'modal'] as const) {
      const { container } = render(
        <PermissionPrompt
          layout={layout}
          prompts={[prompt]}
          onAnswerPermission={vi.fn()}
          onAnswerAsk={vi.fn()}
        />,
      );
      expect((container.firstElementChild as HTMLElement).classList).toContain('robota-ui');
      cleanup();
    }
  });

  it('AgentActivityPanel', () => {
    const { container } = render(<AgentActivityPanel tasks={[]} />);
    expect((container.firstElementChild as HTMLElement).classList).toContain('robota-ui');
  });
});
