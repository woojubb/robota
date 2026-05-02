import React from 'react';
import { Box, Text } from 'ink';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import { formatTokenCount } from '@robota-sdk/agent-core';
import type { IUsageSnapshot } from '@robota-sdk/agent-sdk';

const TOKEN_COMPACT_THRESHOLD = 1000;

export default function UsageSummaryEntry({ entry }: { entry: IHistoryEntry }): React.ReactElement {
  const usage = entry.data as IUsageSnapshot | undefined;
  if (!usage) return <></>;
  const prompt = usage.promptTokens !== undefined ? formatUsageTokenCount(usage.promptTokens) : '?';
  const completion =
    usage.completionTokens !== undefined ? formatUsageTokenCount(usage.completionTokens) : '?';
  const total = formatUsageTokenCount(usage.totalTokens);
  const context = `${Math.round(usage.contextUsedPercentage)}% (${formatTokenCount(
    usage.contextUsedTokens,
  )}/${formatTokenCount(usage.contextMaxTokens)})`;
  const costLabel = usage.costStatus === 'unknown' ? 'cost unknown' : `cost ${usage.costStatus}`;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="white" bold>
          Usage:{' '}
        </Text>
        <Text dimColor>
          {usage.kind} {total} tokens (in {prompt} / out {completion}) · Context {context} ·{' '}
          {costLabel}
        </Text>
      </Box>
    </Box>
  );
}

function formatUsageTokenCount(tokens: number): string {
  return tokens < TOKEN_COMPACT_THRESHOLD ? tokens.toLocaleString() : formatTokenCount(tokens);
}
