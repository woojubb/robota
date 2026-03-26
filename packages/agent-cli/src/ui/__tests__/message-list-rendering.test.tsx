/**
 * Rendering tests for MessageList — verifies that IHistoryEntry[]
 * entries render with correct labels and content.
 *
 * These tests catch rendering bugs that data-flow tests miss:
 * - tool-summary must show "Tool:" not "System: tool-summary"
 * - chat messages must show correct role labels
 * - event entries must show formatted content
 */

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import MessageList from '../MessageList.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import {
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  messageToHistoryEntry,
} from '@robota-sdk/agent-core';

function makeToolSummaryEntry(): IHistoryEntry {
  return {
    id: 'tool-1',
    timestamp: new Date(),
    category: 'event',
    type: 'tool-summary',
    data: {
      tools: [
        { toolName: 'Read', firstArg: 'file.ts', isRunning: false, result: 'success' },
        { toolName: 'Edit', firstArg: 'file.ts', isRunning: false, result: 'success' },
      ],
      summary: '✓ Read(file.ts)\n✓ Edit(file.ts)',
    },
  };
}

function makeSkillInvocationEntry(): IHistoryEntry {
  return {
    id: 'evt-1',
    timestamp: new Date(),
    category: 'event',
    type: 'skill-invocation',
    data: { skillName: 'audit', source: 'plugin', message: 'Invoking plugin: audit' },
  };
}

describe('MessageList rendering', () => {
  // ── Tool summary rendering ────────────────────────────────────

  it('tool-summary event renders with "Tool:" label, not "System:"', () => {
    const history: IHistoryEntry[] = [makeToolSummaryEntry()];
    const { lastFrame } = render(<MessageList history={history} />);
    const output = lastFrame() ?? '';

    expect(output).toContain('Tool:');
    expect(output).not.toContain('System: tool-summary');
  });

  it('tool-summary shows formatted tool names', () => {
    const history: IHistoryEntry[] = [makeToolSummaryEntry()];
    const { lastFrame } = render(<MessageList history={history} />);
    const output = lastFrame() ?? '';

    expect(output).toContain('Read(file.ts)');
    expect(output).toContain('Edit(file.ts)');
  });

  // ── Skill invocation rendering ────────────────────────────────

  it('skill-invocation event renders with "System:" label and message', () => {
    const history: IHistoryEntry[] = [makeSkillInvocationEntry()];
    const { lastFrame } = render(<MessageList history={history} />);
    const output = lastFrame() ?? '';

    expect(output).toContain('System:');
    expect(output).toContain('Invoking plugin: audit');
  });

  // ── Chat message rendering ────────────────────────────────────

  it('user message renders with "You:" label', () => {
    const history: IHistoryEntry[] = [messageToHistoryEntry(createUserMessage('hello'))];
    const { lastFrame } = render(<MessageList history={history} />);
    const output = lastFrame() ?? '';

    expect(output).toContain('You:');
    expect(output).toContain('hello');
  });

  it('assistant message renders with "Robota:" label', () => {
    const history: IHistoryEntry[] = [
      messageToHistoryEntry(createAssistantMessage('response text')),
    ];
    const { lastFrame } = render(<MessageList history={history} />);
    const output = lastFrame() ?? '';

    expect(output).toContain('Robota:');
    expect(output).toContain('response text');
  });

  it('system message renders with "System:" label', () => {
    const history: IHistoryEntry[] = [
      messageToHistoryEntry(createSystemMessage('Interrupted by user.')),
    ];
    const { lastFrame } = render(<MessageList history={history} />);
    const output = lastFrame() ?? '';

    expect(output).toContain('System:');
    expect(output).toContain('Interrupted by user.');
  });

  // ── Display order after abort ─────────────────────────────────

  it('abort display order: You → Tool → Robota → System', () => {
    const history: IHistoryEntry[] = [
      messageToHistoryEntry(createUserMessage('/audit')),
      makeToolSummaryEntry(),
      messageToHistoryEntry(createAssistantMessage('partial response')),
      messageToHistoryEntry(createSystemMessage('Interrupted by user.')),
    ];

    const { lastFrame } = render(<MessageList history={history} />);
    const output = lastFrame() ?? '';

    const youIdx = output.indexOf('You:');
    const toolIdx = output.indexOf('Tool:');
    const robotaIdx = output.indexOf('Robota:');
    const systemIdx = output.indexOf('Interrupted by user.');

    // All must be present
    expect(youIdx).toBeGreaterThanOrEqual(0);
    expect(toolIdx).toBeGreaterThanOrEqual(0);
    expect(robotaIdx).toBeGreaterThanOrEqual(0);
    expect(systemIdx).toBeGreaterThanOrEqual(0);

    // Order: You → Tool → Robota → System
    expect(youIdx).toBeLessThan(toolIdx);
    expect(toolIdx).toBeLessThan(robotaIdx);
    expect(robotaIdx).toBeLessThan(systemIdx);
  });

  // ── Mixed history ─────────────────────────────────────────────

  it('renders mixed chat and event entries in order', () => {
    const history: IHistoryEntry[] = [
      messageToHistoryEntry(createUserMessage('hello')),
      makeSkillInvocationEntry(),
      makeToolSummaryEntry(),
      messageToHistoryEntry(createAssistantMessage('done')),
    ];

    const { lastFrame } = render(<MessageList history={history} />);
    const output = lastFrame() ?? '';

    // All four entries rendered
    expect(output).toContain('You:');
    expect(output).toContain('Invoking plugin: audit');
    expect(output).toContain('Tool:');
    expect(output).toContain('Robota:');
  });
});
