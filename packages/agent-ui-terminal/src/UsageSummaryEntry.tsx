import { formatTokenCount } from '@robota-sdk/agent-core';
import { Box } from 'ink';
import React from 'react';

import { Text } from './SafeText.js';
import { usePalette } from './theme/index.js';

import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { IUsageSnapshot } from '@robota-sdk/agent-interface-analytics';

const TOKEN_COMPACT_THRESHOLD = 1000;

export default function UsageSummaryEntry({ entry }: { entry: IHistoryEntry }): React.ReactElement {
  const palette = usePalette();
  const usage = entry.data as IUsageSnapshot | undefined;
  if (!usage) return <></>;
  const prompt = usage.promptTokens !== undefined ? formatUsageTokenCount(usage.promptTokens) : '?';
  const completion =
    usage.completionTokens !== undefined ? formatUsageTokenCount(usage.completionTokens) : '?';
  const total = formatUsageTokenCount(usage.totalTokens);
  // Usage another unit spent (the advisor, a background task) is named, and has no context window
  // of the main thread to report.
  const source =
    usage.source !== undefined && usage.source.scope !== 'main' ? usage.source : undefined;
  const sourceLabel = source ? (source.label ?? source.id ?? source.scope) : undefined;
  const context = source
    ? ''
    : ` · Context ${Math.round(usage.contextUsedPercentage)}% (${formatTokenCount(
        usage.contextUsedTokens,
      )}/${formatTokenCount(usage.contextMaxTokens)})`;
  const costLabel = usage.costStatus === 'unknown' ? 'cost unknown' : `cost ${usage.costStatus}`;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={palette.text.emphasis} bold>
          {sourceLabel ? `Usage (${sourceLabel}):` : 'Usage:'}{' '}
        </Text>
        <Text dimColor>
          {usage.kind} {total} tokens (in {prompt} / out {completion}){context} · {costLabel}
        </Text>
      </Box>
    </Box>
  );
}

function formatUsageTokenCount(tokens: number): string {
  return tokens < TOKEN_COMPACT_THRESHOLD ? tokens.toLocaleString() : formatTokenCount(tokens);
}
