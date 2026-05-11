/**
 * Rendering tests for MessageList — verifies that IHistoryEntry[]
 * entries render with correct labels and content.
 *
 * These tests catch rendering bugs that data-flow tests miss:
 * - tool execution list must show "Tool:" label with tool names
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
  createToolMessage,
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
    type: 'skill-activation',
    data: {
      type: 'skill-activation',
      skillName: 'audit',
      source: 'plugin',
      invocation: 'user-slash',
      mode: 'inject',
      status: 'started',
      timestamp: '2026-05-06T00:00:00.000Z',
      message: 'Invoking plugin skill: audit',
    },
  };
}

describe('MessageList rendering', () => {
  // ── Tool summary rendering ────────────────────────────────────

  it('tool execution list renders with "Tool:" label and tool names', () => {
    const history: IHistoryEntry[] = [makeToolSummaryEntry()];
    const { lastFrame } = render(<MessageList history={history} />);
    const output = lastFrame() ?? '';

    expect(output).toContain('Tool:');
    expect(output).toContain('Read(file.ts)');
    expect(output).toContain('Edit(file.ts)');
  });

  // ── Skill invocation rendering ────────────────────────────────

  it('skill-activation event renders with "System:" label and message', () => {
    const history: IHistoryEntry[] = [makeSkillInvocationEntry()];
    const { lastFrame } = render(<MessageList history={history} />);
    const output = lastFrame() ?? '';

    expect(output).toContain('System:');
    expect(output).toContain('Invoking plugin skill: audit');
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

  it('assistant message preserves CJK and emoji content', () => {
    const content = '긴 한국어 응답과 emoji 🎉 를 표시합니다';
    const history: IHistoryEntry[] = [messageToHistoryEntry(createAssistantMessage(content))];
    const { lastFrame } = render(<MessageList history={history} />);

    expect(lastFrame()).toContain(content);
  });

  it('assistant message renders markdown diff fenced code block content', () => {
    const response = [
      'Patch preview:',
      '',
      '```diff',
      '- const oldValue = true;',
      '+ const newValue = true;',
      '```',
    ].join('\n');
    const history: IHistoryEntry[] = [messageToHistoryEntry(createAssistantMessage(response))];
    const { lastFrame } = render(<MessageList history={history} />);
    const output = lastFrame() ?? '';

    expect(output).toContain('Robota:');
    expect(output).toContain('Patch preview:');
    expect(output).toContain('- const oldValue = true;');
    expect(output).toContain('+ const newValue = true;');
  });

  it('tool message diff summary renders through markdown diff body format', () => {
    const toolSummary = [
      {
        line: 'Edit(/src/index.ts)',
        diffFile: '/src/index.ts',
        diffLines: [
          { type: 'remove', lineNumber: 1, text: 'const oldValue = true;' },
          { type: 'add', lineNumber: 1, text: 'const newValue = true;' },
        ],
      },
    ];
    const history: IHistoryEntry[] = [
      messageToHistoryEntry(
        createToolMessage(JSON.stringify(toolSummary), {
          toolCallId: 'call_1',
          name: 'tools',
        }),
      ),
    ];

    const { lastFrame } = render(<MessageList history={history} />);
    const output = lastFrame() ?? '';

    expect(output).toContain('/src/index.ts');
    expect(output).toContain('- 1 | const oldValue = true;');
    expect(output).toContain('+ 1 | const newValue = true;');
    expect(output).not.toContain('│ 1 - const oldValue = true;');
  });

  it('tool-summary event renders persisted edit diff metadata', () => {
    const history: IHistoryEntry[] = [
      {
        id: 'summary_1',
        timestamp: new Date(),
        category: 'event',
        type: 'tool-summary',
        data: {
          tools: [
            {
              toolName: 'Edit',
              firstArg: '/src/index.ts',
              isRunning: false,
              result: 'success',
              diffFile: '/src/index.ts',
              diffLines: [
                { type: 'remove', lineNumber: 1, text: 'const temporary = true;' },
                { type: 'add', lineNumber: 1, text: 'const original = true;' },
              ],
            },
          ],
          summary: '✓ Edit(/src/index.ts)',
        },
      },
    ];

    const { lastFrame } = render(<MessageList history={history} />);
    const output = lastFrame() ?? '';

    expect(output).toContain('/src/index.ts');
    expect(output).toContain('- 1 | const temporary = true;');
    expect(output).toContain('+ 1 | const original = true;');
  });

  it('tool-summary event collapses long command output with transcript hint', () => {
    const commandOutput = Array.from({ length: 7 }, (_, index) => `line-${index + 1}`).join('\n');
    const history: IHistoryEntry[] = [
      {
        id: 'summary_command_long',
        timestamp: new Date(),
        category: 'event',
        type: 'tool-summary',
        data: {
          tools: [
            {
              toolName: 'Bash',
              firstArg: 'pnpm test',
              isRunning: false,
              result: 'success',
              toolResultData: JSON.stringify({
                success: true,
                output: commandOutput,
                exitCode: 0,
              }),
            },
          ],
          summary: '✓ Bash(pnpm test)',
        },
      },
    ];

    const { lastFrame } = render(<MessageList history={history} />);
    const output = lastFrame() ?? '';

    expect(output).toContain('✓ Bash(pnpm test)');
    expect(output).toContain('line-1');
    expect(output).toContain('line-4');
    expect(output).not.toContain('line-5');
    expect(output).toContain('... +3 lines (full output in session transcript)');
  });

  it('tool-summary event marks non-zero command exits as failed', () => {
    const history: IHistoryEntry[] = [
      {
        id: 'summary_command_failed',
        timestamp: new Date(),
        category: 'event',
        type: 'tool-summary',
        data: {
          tools: [
            {
              toolName: 'Bash',
              firstArg: 'exit 42',
              isRunning: false,
              result: 'success',
              toolResultData: JSON.stringify({ success: true, output: '', exitCode: 42 }),
            },
          ],
          summary: '✓ Bash(exit 42)',
        },
      },
    ];

    const { lastFrame } = render(<MessageList history={history} />);
    const output = lastFrame() ?? '';

    expect(output).toContain('✗ Bash(exit 42)');
    expect(output).toContain('exit 42');
  });

  it('usage-summary event renders compact token and cost visibility', () => {
    const history: IHistoryEntry[] = [
      {
        id: 'usage_1',
        timestamp: new Date(),
        category: 'event',
        type: 'usage-summary',
        data: {
          kind: 'exact',
          scope: 'turn',
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          contextUsedTokens: 150,
          contextMaxTokens: 1000,
          contextUsedPercentage: 15,
          costStatus: 'unknown',
        },
      },
    ];

    const { lastFrame } = render(<MessageList history={history} />);
    const output = lastFrame() ?? '';

    expect(output).toContain('Usage:');
    expect(output).toContain('exact');
    expect(output).toContain('150 tokens');
    expect(output).toContain('in 100');
    expect(output).toContain('out 50');
    expect(output).toContain('cost unknown');
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
    expect(output).toContain('Invoking plugin skill: audit');
    expect(output).toContain('Tool:');
    expect(output).toContain('Robota:');
  });
});
