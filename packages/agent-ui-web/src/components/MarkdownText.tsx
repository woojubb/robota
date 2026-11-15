'use client';

import React from 'react';

import { AgentMarkdown } from './ConversationView.js';

/**
 * Text an agent wrote, outside a conversation: a report, a notice. It reads the way the same text
 * does in a chat, so a surface that shows it does not show the person raw Markdown.
 */
export function MarkdownText({
  children,
  className = '',
}: {
  readonly children: string;
  readonly className?: string;
}): React.ReactElement {
  return (
    <div className={`gui-prose ${className}`.trim()}>
      <AgentMarkdown>{children}</AgentMarkdown>
    </div>
  );
}
