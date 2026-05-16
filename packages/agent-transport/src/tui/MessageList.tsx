import React from 'react';
import { Box, Text } from 'ink';
import type { IHistoryEntry, TUniversalMessage, TUniversalValue } from '@robota-sdk/agent-core';
import { isToolMessage, isAssistantMessage } from '@robota-sdk/agent-core';
import { renderMarkdown } from './render-markdown.js';
import type { IToolCallSummary } from './utils/tool-call-extractor.js';
import ToolDiffBlock from './ToolDiffBlock.js';
import UsageSummaryEntry from './UsageSummaryEntry.js';
import { formatCommandOutputSummary } from './command-output-summary.js';
import ToolCommandOutput from './ToolCommandOutput.js';

interface IProps {
  history: IHistoryEntry[];
}

type TToolSummaryItem = {
  toolName: string;
  firstArg?: string;
  isRunning?: boolean;
  result?: string;
  diffLines?: IToolCallSummary['diffLines'];
  diffFile?: string;
  toolResultData?: string;
};

function getToolSummaryStatus(tool: TToolSummaryItem): string {
  if (formatCommandOutputSummary(tool)?.status === 'error') return '✗';
  if (tool.isRunning) return '⟳';
  if (tool.result === 'error') return '✗';
  if (tool.result === 'denied') return '⊘';
  return '✓';
}

function getToolSummaryColor(tool: TToolSummaryItem): string {
  if (formatCommandOutputSummary(tool)?.status === 'error' || tool.result === 'error') return 'red';
  if (tool.isRunning || tool.result === 'denied') return 'yellow';
  return 'green';
}

function getToolSummaryLabel(tool: TToolSummaryItem): string {
  return `${getToolSummaryStatus(tool)} ${tool.toolName}${tool.firstArg ? `(${tool.firstArg})` : ''}`;
}

function RoleLabel({ role }: { role: TUniversalMessage['role'] }): React.ReactElement {
  switch (role) {
    case 'user':
      return (
        <Text color="green" bold>
          You:{' '}
        </Text>
      );
    case 'assistant':
      return (
        <Text color="cyan" bold>
          Robota:{' '}
        </Text>
      );
    case 'system':
      return (
        <Text color="yellow" bold>
          System:{' '}
        </Text>
      );
    case 'tool':
      return (
        <Text color="white" bold>
          Tool:{' '}
        </Text>
      );
  }
}

function ToolMessage({ message }: { message: TUniversalMessage }): React.ReactElement {
  if (!isToolMessage(message)) {
    return <></>;
  }
  const toolName = message.name;
  const content = message.content;

  // Try to parse structured tool summaries (with diff info)
  let summaries: IToolCallSummary[] | null = null;
  try {
    const parsed = JSON.parse(content) as IToolCallSummary[];
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0].line === 'string') {
      summaries = parsed as IToolCallSummary[];
    }
  } catch {
    // Not JSON — fall back to plain text lines
  }

  if (summaries) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color="white" bold>
            Tool:{' '}
          </Text>
          {toolName && (
            <Text color="white" dimColor>
              [{toolName}]
            </Text>
          )}
        </Box>
        <Text> </Text>
        {summaries.map((s, i) => (
          <Box key={i} flexDirection="column">
            <Text color="green">
              {'  '}
              {'✓'} {s.line}
            </Text>
            {s.diffLines && s.diffLines.length > 0 && (
              <ToolDiffBlock file={s.diffFile} lines={s.diffLines} />
            )}
          </Box>
        ))}
      </Box>
    );
  }

  // Fallback: plain text lines
  const lines = content.split('\n').filter((l) => l.trim());
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="white" bold>
          Tool:{' '}
        </Text>
        {toolName && (
          <Text color="white" dimColor>
            [{toolName}]
          </Text>
        )}
      </Box>
      <Text> </Text>
      {lines.map((line, i) => (
        <Text key={i} color="green">
          {'  '}
          {'✓'} {line}
        </Text>
      ))}
    </Box>
  );
}

const MessageItem = React.memo(function MessageItem({
  message,
}: {
  message: TUniversalMessage;
}): React.ReactElement {
  if (isToolMessage(message)) {
    return <ToolMessage message={message} />;
  }

  const content = message.content ?? '';
  const isInterrupted = message.state === 'interrupted';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <RoleLabel role={message.role} />
      </Box>
      <Text> </Text>
      <Box marginLeft={2}>
        <Text wrap="wrap">
          {isAssistantMessage(message)
            ? renderMarkdown(content + (isInterrupted ? '\n\n_(interrupted)_' : ''))
            : content}
        </Text>
      </Box>
    </Box>
  );
});

function ToolSummaryEntry({ entry }: { entry: IHistoryEntry }): React.ReactElement {
  const data = entry.data as
    | {
        summary?: string;
        tools?: TToolSummaryItem[];
      }
    | undefined;
  const tools = data?.tools;
  const lines = data?.summary?.split('\n') ?? [];

  if (tools && tools.length > 0) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color="white" bold>
            Tool:{' '}
          </Text>
        </Box>
        <Text> </Text>
        {tools.map((tool, i) => (
          <Box key={i} flexDirection="column">
            <Text color={getToolSummaryColor(tool)}>
              {'  '}
              {getToolSummaryLabel(tool)}
            </Text>
            <ToolCommandOutput tool={tool} />
            {tool.diffLines && tool.diffLines.length > 0 && (
              <ToolDiffBlock file={tool.diffFile} lines={tool.diffLines} />
            )}
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="white" bold>
          Tool:{' '}
        </Text>
      </Box>
      <Text> </Text>
      {lines.map((line, i) => (
        <Text key={i} color="green">
          {'  '}
          {line}
        </Text>
      ))}
    </Box>
  );
}

function EventEntry({ entry }: { entry: IHistoryEntry }): React.ReactElement {
  const eventData = entry.data as Record<string, TUniversalValue> | undefined;
  const eventMessage =
    typeof eventData?.message === 'string'
      ? eventData.message
      : typeof eventData?.content === 'string'
        ? eventData.content
        : entry.type;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="yellow" bold>
          System:{' '}
        </Text>
      </Box>
      <Text> </Text>
      <Box marginLeft={2}>
        <Text wrap="wrap">{eventMessage}</Text>
      </Box>
    </Box>
  );
}

function EntryItem({ entry }: { entry: IHistoryEntry }): React.ReactElement {
  if (entry.category === 'chat') {
    const message = entry.data as TUniversalMessage;
    return <MessageItem message={message} />;
  }

  if (entry.type === 'tool-summary') {
    return <ToolSummaryEntry entry={entry} />;
  }

  if (entry.type === 'usage-summary') {
    return <UsageSummaryEntry entry={entry} />;
  }

  // tool-start/tool-end are recorded in history for persistence but not rendered
  // (StreamingIndicator shows them during streaming, tool-summary shows them after)
  if (entry.type === 'tool-start' || entry.type === 'tool-end') {
    return <></>;
  }

  return <EventEntry entry={entry} />;
}

export default function MessageList({ history }: IProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      {history.map((entry) => (
        <EntryItem key={entry.id} entry={entry} />
      ))}
    </Box>
  );
}
